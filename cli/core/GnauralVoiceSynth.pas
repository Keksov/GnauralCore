unit GnauralVoiceSynth;

{$mode objfpc}{$H+}

interface

uses
    Math;

const
    BB_AUDIOSAMPLERATE      = 44100;
    BB_TWO_PI               = 6.2831853071795864769252866;
    BB_SAMPLE_FACTOR        = BB_TWO_PI / BB_AUDIOSAMPLERATE;
    BB_SIN_SCALER           = $3FFF;
    BB_UPDATE_PERIOD        = 16;
    BB_DROPLEN              = 8192;
    BB_RAINLEN              = 44;

type
    TWaterdrop = record
        count               : Single;
        decrement           : Single;
        stereoMix           : Single;
    end;

    TVoiceSynthState = record
        FcurEntry           : Integer;
        FnoiseL             : Integer;
        FnoiseR             : Integer;
        FdropCount          : Integer;
        FwaterMixL          : Integer;
        FwaterMixR          : Integer;
        FphaseSampleCount   : Integer;
        FphaseSampleCountStart : Integer;
        FphaseFlag          : Integer;
        FcurVolL            : Double;
        FcurVolR            : Double;
        FcurBasefreq        : Double;
        FcurBeatfreq        : Double;
        FphaseEnvelope      : Double;
        FsinPosL            : Double;
        FsinPosR            : Double;
        FcurBeatfreqLfactor : Double;
        FcurBeatfreqRfactor : Double;
        // Real-time control overrides (written by main thread; read by audio thread)
        FoverrideVolL       : Double;
        FoverrideVolR       : Double;
        FoverrideBasefreq   : Double;
        FoverrideBeatfreq   : Double;
        Fmuted              : LongBool;
        // PCM playback
        FpcmData            : array of Integer;
        FpcmPos             : Cardinal;
        Fdrops              : array of TWaterdrop;
        // External stdin voice runtime state (audio thread only):
        FextFromBase        : Double;
        FextToBase          : Double;
        FextFromBeat        : Double;
        FextToBeat          : Double;
        FextFromVolL        : Double;
        FextToVolL          : Double;
        FextFromVolR        : Double;
        FextToVolR          : Double;
        FextGlide           : Cardinal;   // samples remaining in current glide
        FextGlideTotal      : Cardinal;   // total samples for current glide
        FextDurLeft         : Cardinal;   // samples remaining in hold after glide
        FextDurFinite       : LongBool;   // false means infinite/no active finite hold
        FextSeqSeen         : LongInt;    // last seqlock seq the audio thread processed
        // Pending slot - stdin thread writes, audio thread reads (seqlock on x86-64):
        FextPendBase        : Double;
        FextPendBeat        : Double;
        FextPendVolL        : Double;
        FextPendVolR        : Double;
        FextPendGlide       : Cardinal;
        FextPendDur         : Cardinal;
        FextPendSeq         : LongInt;    // even=ready, odd=write-in-progress, 0=none
    end;

// Initialize voice state to defaults
procedure initVoiceSynthState(var aState: TVoiceSynthState);

// Seed the shared RNG
procedure bbSeedRand(aI1, aI2: LongWord);

// Return a random signed integer in full range
function  bbRand: LongInt;

// Low-pass filter: returns filtered value, updating aState in-place
function  bbLoPass(var aState: Integer; aValue: Integer): Integer;

// Generate the global drop-mother waveform arrays (called once)
function  getDropMother: PSmallInt;
function  getRainMother: PSmallInt;

// Initialize per-voice drop array — call after voice type and drop count are known
procedure waterVoiceInit(var aState: TVoiceSynthState; aBeatfreqHalfStart: Double);

// Generate water/rain samples; writes result to aState.FwaterMixL/R
procedure waterStep(var aState: TVoiceSynthState; aMotherArray: PSmallInt; aArrayLen: Integer; aLowcut: Single);

implementation

var
    gMcgn: LongWord = 3677;
    gSrgn: LongWord = 127;
    gDropMother: array of SmallInt;
    gRainMother: array of SmallInt;

procedure bbSeedRand(aI1, aI2: LongWord);
begin
    if aI1 = 0 then
        gMcgn := 0
    else
        gMcgn := aI1 or 1;
    if aI2 = LongWord(-1) then
        aI2 := aI1 + 1;
    if aI2 = 0 then
        gSrgn := 0
    else
        gSrgn := (aI2 and $7FF) or 1;
end;

function bbRand: LongInt;
var
    r0, r1: LongWord;
begin
    r0 := gSrgn shr 15;
    r1 := gSrgn xor r0;
    r0 := r1 shl 17;
    gSrgn := r0 xor r1;
    gMcgn := 69069 * gMcgn;
    r1 := gMcgn xor gSrgn;
    Result := LongInt(r1);
end;

function bbLoPass(var aState: Integer; aValue: Integer): Integer;
begin
    aState := SarLongInt((aState * 31) + aValue, 5);
    Result := aState;
end;

procedure buildMotherArray(var aArr: array of SmallInt; aPitch: Double);
var
    i, n: Integer;
    p, q, r, s: Double;
begin
    n := Length(aArr);
    p := 0;
    q := 1.0 / aPitch;
    r := 0;
    s := $7FFF / n;
    for i := 0 to n - 1 do
    begin
        aArr[i] := Round(r * sin(p * BB_TWO_PI));
        p := p + q;
        r := r + s;
    end;
end;

function getDropMother: PSmallInt;
begin
    if Length(gDropMother) = 0 then
    begin
        SetLength(gDropMother, BB_DROPLEN);
        buildMotherArray(gDropMother, 600.0);
    end;
    Result := @gDropMother[0];
end;

function getRainMother: PSmallInt;
begin
    if Length(gRainMother) = 0 then
    begin
        SetLength(gRainMother, BB_RAINLEN);
        buildMotherArray(gRainMother, 3.4);
    end;
    Result := @gRainMother[0];
end;

procedure waterVoiceInit(var aState: TVoiceSynthState; aBeatfreqHalfStart: Double);
var
    i, cnt: Integer;
begin
    cnt := Round(aBeatfreqHalfStart * 2);
    if cnt < 2 then cnt := 2;
    if cnt > 100 then cnt := 100;
    aState.FdropCount := cnt;
    SetLength(aState.Fdrops, cnt);
    for i := 0 to cnt - 1 do
    begin
        aState.Fdrops[i].count := 0;
        aState.Fdrops[i].decrement := 1;
        aState.Fdrops[i].stereoMix := 0.5;
    end;
end;

procedure waterStep(var aState: TVoiceSynthState; aMotherArray: PSmallInt; aArrayLen: Integer; aLowcut: Single);
const
    Window = 126;
var
    p, mixL, mixR: Integer;
    drop: TWaterdrop;
    sampleVal: SmallInt;
begin
    if aState.FdropCount = 0 then
        Exit;
    mixL := 0;
    mixR := 0;
    for p := 0 to aState.FdropCount - 1 do
    begin
        drop := aState.Fdrops[p];
        if drop.count >= 0 then
        begin
            sampleVal := (aMotherArray + Round(drop.count))^;
            mixL := mixL + Round(sampleVal * drop.stereoMix);
            mixR := mixR + Round(sampleVal * (1.0 - drop.stereoMix));
            drop.count := drop.count - drop.decrement;
            aState.Fdrops[p] := drop;
        end
        else if aState.FcurBasefreq > (Random * 1.0) then
        begin
            aState.Fdrops[p].count := aArrayLen - 1;
            aState.Fdrops[p].decrement := (Random * Window) + aLowcut;
            aState.Fdrops[p].stereoMix := Random;
        end;
    end;
    aState.FwaterMixL := bbLoPass(aState.FnoiseL, mixL);
    aState.FwaterMixR := bbLoPass(aState.FnoiseR, mixR);
end;

procedure initVoiceSynthState(var aState: TVoiceSynthState);
begin
    aState.FcurEntry := 0;
    aState.FnoiseL := 1;
    aState.FnoiseR := 1;
    aState.FdropCount := 0;
    aState.FwaterMixL := 0;
    aState.FwaterMixR := 0;
    aState.FphaseSampleCount := 1;
    aState.FphaseSampleCountStart := 1;
    aState.FphaseFlag := 0;
    aState.FcurVolL := 0;
    aState.FcurVolR := 0;
    aState.FcurBasefreq := 0;
    aState.FcurBeatfreq := 0;
    aState.FphaseEnvelope := 0;
    aState.FsinPosL := 0;
    aState.FsinPosR := 0;
    aState.FcurBeatfreqLfactor := 0;
    aState.FcurBeatfreqRfactor := 0;
    aState.FoverrideVolL := -1;
    aState.FoverrideVolR := -1;
    aState.FoverrideBasefreq := -1;
    aState.FoverrideBeatfreq := -1;
    aState.Fmuted := False;
    SetLength(aState.FpcmData, 0);
    aState.FpcmPos := 0;
    SetLength(aState.Fdrops, 0);
    aState.FextFromBase    := 0;
    aState.FextToBase      := 0;
    aState.FextFromBeat    := 0;
    aState.FextToBeat      := 0;
    aState.FextFromVolL    := 0;
    aState.FextToVolL      := 0;
    aState.FextFromVolR    := 0;
    aState.FextToVolR      := 0;
    aState.FextGlide       := 0;
    aState.FextGlideTotal  := 0;
    aState.FextDurLeft     := 0;
    aState.FextDurFinite   := False;
    aState.FextSeqSeen     := 0;
    aState.FextPendBase    := 0;
    aState.FextPendBeat    := 0;
    aState.FextPendVolL    := 0;
    aState.FextPendVolR    := 0;
    aState.FextPendGlide   := 0;
    aState.FextPendDur     := 0;
    aState.FextPendSeq     := 0;
end;

end.
