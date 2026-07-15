unit GnauralSynth;

{$mode objfpc}{$H+}

interface

uses
    SysUtils, Math, SyncObjs,
    GnauralSchedule,
    GnauralVoiceSynth,
    GnauralAudioFileReader;

type

    {***************************************************************************
     * TGnauralSynth
     ***************************************************************************}
    TGnauralSynth = class
private
    Fschedule               : TGnauralSchedule;
    FvoiceStates            : array of TVoiceSynthState;
    FvoiceCount             : Integer;
    FupdatePeriod           : Integer;
    FcurrentSampleCount     : Cardinal;
    FcurrentLoop            : Integer;
    FtotalSamples           : Cardinal;
    Fcompleted              : LongBool;
    // Immutable after Create (from schedule):
    FstereoSwap             : Boolean;
    // Real-time control fields (lock-free on x86-64 via alignment):
    Fpaused                 : LongBool;
    FseekTarget             : Int64;
    FmasterVolLeft          : Double;
    FmasterVolRight         : Double;

private
    procedure   initVoiceStates;
    procedure   resetAllVoiceEntries;

public
    constructor Create(aSchedule: TGnauralSchedule);
    destructor  Destroy; override;

    // Called from PortAudio callback thread; fills aOutput with 16-bit stereo PCM
    procedure   fillBuffer(aOutput: Pointer; aFrameCount: Cardinal);

    // Real-time control — safe to call from any thread
    procedure   pause;
    procedure   resume;
    function    isPaused: Boolean;
    procedure   seek(aTimeSeconds: Double);
    procedure   setMasterVolume(aVolLeft, aVolRight: Double);
    procedure   muteVoice(aVoiceIndex: Integer; aMuted: Boolean);
    procedure   setVoiceBeatFreq(aVoiceIndex: Integer; aBeatFreq: Double);
    procedure   setVoiceBaseFreq(aVoiceIndex: Integer; aBaseFreq: Double);
    procedure   setVoiceVolume(aVoiceIndex: Integer; aVolL, aVolR: Double);
    // External stdin entry push - safe to call from any thread
    procedure   pushExternalEntry(aVoiceIndex: Integer;
                    aBaseFreq, aBeatFreq, aVolL, aVolR: Double;
                    aTransitionTimeSec, aDurationSec: Double);
    function    getPlaybackPosition: Double;
    function    isCompleted: Boolean;
    function    getVoiceCount: Integer;
    end;

implementation

{ TGnauralSynth }

constructor TGnauralSynth.Create(aSchedule: TGnauralSchedule);
var
    v: Integer;
begin
    inherited Create;
    Fschedule := aSchedule;
    FvoiceCount := aSchedule.VoiceCount;
    FupdatePeriod := 1;
    FcurrentSampleCount := 0;
    FcurrentLoop := aSchedule.LoopCount;
    FtotalSamples := Round(aSchedule.TotalTime * BB_AUDIOSAMPLERATE);
    Fcompleted := False;
    Fpaused := False;
    FseekTarget := -1;
    FmasterVolLeft := aSchedule.OverallVolLeft;
    FmasterVolRight := aSchedule.OverallVolRight;
    FstereoSwap := aSchedule.StereoSwap;
    SetLength(FvoiceStates, FvoiceCount);
    initVoiceStates;
end;

destructor TGnauralSynth.Destroy;
var
    v: Integer;
begin
    for v := 0 to FvoiceCount - 1 do
    begin
        SetLength(FvoiceStates[v].FpcmData, 0);
        SetLength(FvoiceStates[v].Fdrops, 0);
    end;
    SetLength(FvoiceStates, 0);
    inherited Destroy;
end;

procedure TGnauralSynth.initVoiceStates;
var
    v: Integer;
    voice: TVoice;
    e0: TScheduleEntry;
    pcmBuf: TIntegerDynArray;
    beatfreqHalf: Double;
begin
    for v := 0 to FvoiceCount - 1 do
    begin
        initVoiceSynthState(FvoiceStates[v]);
        FvoiceStates[v].Fmuted := Fschedule.getVoice(v).Mute;

        voice := Fschedule.getVoice(v);
        if voice.EntryCount > 0 then
            e0 := voice.getEntry(0)
        else
            FillChar(e0, SizeOf(e0), 0);

        if (voice.VoiceType = vtWaterdrops) or (voice.VoiceType = vtRain) then
            waterVoiceInit(FvoiceStates[v], e0.beatfreqHalfStart);

        // Isochronic: pre-initialize phase counter
        if (voice.VoiceType = vtIsoPulse) or (voice.VoiceType = vtIsoPulseAlt) then
        begin
            if e0.beatfreqHalfStart * 2 > 0.0001 then
            begin
                FvoiceStates[v].FphaseSampleCountStart := Round(BB_AUDIOSAMPLERATE / 2 / (e0.beatfreqHalfStart * 2));
                FvoiceStates[v].FphaseSampleCount := FvoiceStates[v].FphaseSampleCountStart;
            end;
        end;

        // PCM: load WAV file into pcmData
        if (voice.VoiceType = vtPCM) and (voice.AudioFilePath <> '') then
        begin
            try
                pcmBuf := loadAudioFile(voice.AudioFilePath);
                if Length(pcmBuf) > 0 then
                begin
                    SetLength(FvoiceStates[v].FpcmData, Length(pcmBuf));
                    Move(pcmBuf[0], FvoiceStates[v].FpcmData[0], Length(pcmBuf) * SizeOf(Integer));
                    FvoiceStates[v].FpcmPos := 0;
                    WriteLn('  Loaded PCM: ', voice.AudioFilePath,
                            ' (', Length(pcmBuf), ' samples, ',
                            Length(pcmBuf) div BB_AUDIOSAMPLERATE, 's)');
                end;
            except
                on E: Exception do
                    WriteLn(ErrOutput, '  WARNING: Failed to load PCM file "',
                            voice.AudioFilePath, '": ', E.Message);
            end;
        end;

        // External stdin voice: seed state from XML initial values
        if voice.IsExternalStdin then
        begin
            FvoiceStates[v].FextFromBase   := voice.ExtInitBase;
            FvoiceStates[v].FextToBase     := voice.ExtInitBase;
            FvoiceStates[v].FextFromBeat   := voice.ExtInitBeat;
            FvoiceStates[v].FextToBeat     := voice.ExtInitBeat;
            FvoiceStates[v].FextFromVolL   := voice.ExtInitVolL;
            FvoiceStates[v].FextToVolL     := voice.ExtInitVolL;
            FvoiceStates[v].FextFromVolR   := voice.ExtInitVolR;
            FvoiceStates[v].FextToVolR     := voice.ExtInitVolR;
            FvoiceStates[v].FextGlide      := 0;
            FvoiceStates[v].FextGlideTotal := 0;
            FvoiceStates[v].FextDurLeft    := 0;
            FvoiceStates[v].FextDurFinite  := False;
            FvoiceStates[v].FextSeqSeen    := 0;
            FvoiceStates[v].FextPendSeq    := 0;
            FvoiceStates[v].FcurVolL       := voice.ExtInitVolL;
            FvoiceStates[v].FcurVolR       := voice.ExtInitVolR;
            if voice.VoiceType = vtBinaural then
            begin
                beatfreqHalf := voice.ExtInitBeat / 2;
                FvoiceStates[v].FcurBasefreq        := voice.ExtInitBase;
                FvoiceStates[v].FcurBeatfreq        := voice.ExtInitBeat;
                FvoiceStates[v].FcurBeatfreqLfactor := (voice.ExtInitBase + beatfreqHalf) * BB_SAMPLE_FACTOR;
                FvoiceStates[v].FcurBeatfreqRfactor := (voice.ExtInitBase - beatfreqHalf) * BB_SAMPLE_FACTOR;
            end
            else if (voice.VoiceType = vtIsoPulse) or (voice.VoiceType = vtIsoPulseAlt) then
            begin
                // Seed phase counter so the pulse generator starts at the correct
                // period; without this it defaults to 1 sample (full-rate distortion).
                if voice.ExtInitBeat > 0.0001 then
                begin
                    FvoiceStates[v].FphaseSampleCountStart :=
                        Round(BB_AUDIOSAMPLERATE / 2 / voice.ExtInitBeat);
                    FvoiceStates[v].FphaseSampleCount :=
                        FvoiceStates[v].FphaseSampleCountStart;
                end;
            end;
        end;
    end;
end;

procedure TGnauralSynth.resetAllVoiceEntries;
var
    v: Integer;
begin
    for v := 0 to FvoiceCount - 1 do
        FvoiceStates[v].FcurEntry := 0;
end;

procedure TGnauralSynth.fillBuffer(aOutput: Pointer; aFrameCount: Cardinal);
var
    k, v: Integer;
    ce: Integer;
    pOut: PSmallInt;
    voice: TVoice;
    entry: TScheduleEntry;
    volL, volR: Double;
    sumL, sumR: Double;
    outL, outR: SmallInt;
    sampleL, sampleR: Double;
    dropMother, rainMother: PSmallInt;
    factor, basefreq, beatfreqHalf: Double;
    oldBeatfreq, newBeatfreq, phaseFactor: Double;
    glideFactor: Double;
    extSeq: LongInt;
    extPendBase, extPendBeat, extPendVolL, extPendVolR: Double;
    extPendGlide, extPendDur: Cardinal;
begin
    dropMother := nil;
    rainMother := nil;
    pOut := PSmallInt(aOutput);

    for k := 0 to Integer(aFrameCount) - 1 do
    begin
        Dec(FupdatePeriod);
        sumL := 0;
        sumR := 0;

        if not Fpaused and not Fcompleted then
        begin
            // Handle seek
            if FseekTarget >= 0 then
            begin
                FcurrentSampleCount := Cardinal(FseekTarget);
                FseekTarget := -1;
                resetAllVoiceEntries;
            end;

            for v := 0 to FvoiceCount - 1 do
            begin
                voice := Fschedule.getVoice(v);

                // ===== PERIODIC UPDATE (every BB_UPDATE_PERIOD samples) =====
                if FupdatePeriod = 0 then
                begin
                    if voice.IsExternalStdin then
                    begin
                        // External stdin voice: consume pending entry (seqlock)
                        extSeq := TInterlocked.CompareExchange(FvoiceStates[v].FextPendSeq, 0, 0);
                        if (extSeq and 1 = 0) and (extSeq <> FvoiceStates[v].FextSeqSeen) then
                        begin
                            // Snapshot pending fields to locals before verifying seq
                            ReadWriteBarrier;
                            extPendBase  := FvoiceStates[v].FextPendBase;
                            extPendBeat  := FvoiceStates[v].FextPendBeat;
                            extPendVolL  := FvoiceStates[v].FextPendVolL;
                            extPendVolR  := FvoiceStates[v].FextPendVolR;
                            extPendGlide := FvoiceStates[v].FextPendGlide;
                            extPendDur   := FvoiceStates[v].FextPendDur;
                            ReadWriteBarrier;
                            // Verify seq unchanged - no torn write during snapshot
                            if TInterlocked.CompareExchange(FvoiceStates[v].FextPendSeq, 0, 0) = extSeq then
                            begin
                                FvoiceStates[v].FextSeqSeen := extSeq;
                                // Capture current interpolated position as new "from"
                                if (FvoiceStates[v].FextGlideTotal > 0) and
                                   (FvoiceStates[v].FextGlide > 0) then
                                begin
                                    glideFactor := 1.0 - FvoiceStates[v].FextGlide /
                                        FvoiceStates[v].FextGlideTotal;
                                    FvoiceStates[v].FextFromBase :=
                                        FvoiceStates[v].FextFromBase +
                                        (FvoiceStates[v].FextToBase -
                                         FvoiceStates[v].FextFromBase) * glideFactor;
                                    FvoiceStates[v].FextFromBeat :=
                                        FvoiceStates[v].FextFromBeat +
                                        (FvoiceStates[v].FextToBeat -
                                         FvoiceStates[v].FextFromBeat) * glideFactor;
                                    FvoiceStates[v].FextFromVolL :=
                                        FvoiceStates[v].FextFromVolL +
                                        (FvoiceStates[v].FextToVolL -
                                         FvoiceStates[v].FextFromVolL) * glideFactor;
                                    FvoiceStates[v].FextFromVolR :=
                                        FvoiceStates[v].FextFromVolR +
                                        (FvoiceStates[v].FextToVolR -
                                         FvoiceStates[v].FextFromVolR) * glideFactor;
                                end
                                else
                                begin
                                    // Holding at target — from = current target
                                    FvoiceStates[v].FextFromBase := FvoiceStates[v].FextToBase;
                                    FvoiceStates[v].FextFromBeat := FvoiceStates[v].FextToBeat;
                                    FvoiceStates[v].FextFromVolL := FvoiceStates[v].FextToVolL;
                                    FvoiceStates[v].FextFromVolR := FvoiceStates[v].FextToVolR;
                                end;
                                FvoiceStates[v].FextToBase    := extPendBase;
                                FvoiceStates[v].FextToBeat    := extPendBeat;
                                FvoiceStates[v].FextToVolL    := extPendVolL;
                                FvoiceStates[v].FextToVolR    := extPendVolR;
                                FvoiceStates[v].FextGlideTotal := extPendGlide;
                                FvoiceStates[v].FextGlide     := extPendGlide;
                                FvoiceStates[v].FextDurLeft   := extPendDur;
                                FvoiceStates[v].FextDurFinite := extPendDur > 0;
                            end;
                            // If seq changed, snapshot was torn - skip this cycle, retry next
                        end;

                        if not FvoiceStates[v].Fmuted then
                        begin
                            if (FvoiceStates[v].FextGlideTotal > 0) and
                               (FvoiceStates[v].FextGlide > 0) then
                                glideFactor := 1.0 - FvoiceStates[v].FextGlide /
                                    FvoiceStates[v].FextGlideTotal
                            else
                                glideFactor := 1.0;

                            basefreq := FvoiceStates[v].FextFromBase +
                                (FvoiceStates[v].FextToBase -
                                 FvoiceStates[v].FextFromBase) * glideFactor;
                            beatfreqHalf := (FvoiceStates[v].FextFromBeat +
                                (FvoiceStates[v].FextToBeat -
                                 FvoiceStates[v].FextFromBeat) * glideFactor) / 2;
                            volL := FvoiceStates[v].FextFromVolL +
                                (FvoiceStates[v].FextToVolL -
                                 FvoiceStates[v].FextFromVolL) * glideFactor;
                            volR := FvoiceStates[v].FextFromVolR +
                                (FvoiceStates[v].FextToVolR -
                                 FvoiceStates[v].FextFromVolR) * glideFactor;

                            FvoiceStates[v].FcurVolL := volL;
                            FvoiceStates[v].FcurVolR := volR;

                            case voice.VoiceType of
                                vtBinaural:
                                begin
                                    FvoiceStates[v].FcurBasefreq := basefreq;
                                    FvoiceStates[v].FcurBeatfreq := beatfreqHalf * 2;
                                    FvoiceStates[v].FcurBeatfreqLfactor :=
                                        (basefreq + beatfreqHalf) * BB_SAMPLE_FACTOR;
                                    FvoiceStates[v].FcurBeatfreqRfactor :=
                                        (basefreq - beatfreqHalf) * BB_SAMPLE_FACTOR;
                                end;
                                vtIsoPulse, vtIsoPulseAlt:
                                begin
                                    FvoiceStates[v].FcurBasefreq := basefreq;
                                    oldBeatfreq := FvoiceStates[v].FcurBeatfreq;
                                    newBeatfreq := beatfreqHalf * 2;
                                    if newBeatfreq < 0.0001 then newBeatfreq := 0.0001;
                                    FvoiceStates[v].FcurBeatfreq := newBeatfreq;
                                    if Abs(oldBeatfreq - newBeatfreq) > 1e-9 then
                                    begin
                                        if FvoiceStates[v].FphaseSampleCountStart > 0 then
                                            phaseFactor := FvoiceStates[v].FphaseSampleCount /
                                                FvoiceStates[v].FphaseSampleCountStart
                                        else
                                            phaseFactor := 0;
                                        FvoiceStates[v].FphaseSampleCountStart :=
                                            Round(BB_AUDIOSAMPLERATE / 2.0 / newBeatfreq);
                                        FvoiceStates[v].FphaseSampleCount :=
                                            Round(FvoiceStates[v].FphaseSampleCountStart * phaseFactor);
                                    end;
                                    FvoiceStates[v].FcurBeatfreqLfactor := basefreq * BB_SAMPLE_FACTOR;
                                    FvoiceStates[v].FcurBeatfreqRfactor := basefreq * BB_SAMPLE_FACTOR;
                                end;
                            end; // case voice type (external)
                        end; // if not muted (external)

                        // Advance finite hold: check glide BEFORE decrement so countdown
                        // starts only on ticks where glide was already 0 at entry.
                        if (FvoiceStates[v].FextGlide = 0) and FvoiceStates[v].FextDurFinite then
                        begin
                            if FvoiceStates[v].FextDurLeft > Cardinal(BB_UPDATE_PERIOD) then
                                Dec(FvoiceStates[v].FextDurLeft, BB_UPDATE_PERIOD)
                            else
                            begin
                                FvoiceStates[v].FextDurLeft := 0;
                                FvoiceStates[v].FextDurFinite := False;
                                FvoiceStates[v].FextFromBase := voice.ExtInitBase;
                                FvoiceStates[v].FextToBase := voice.ExtInitBase;
                                FvoiceStates[v].FextFromBeat := voice.ExtInitBeat;
                                FvoiceStates[v].FextToBeat := voice.ExtInitBeat;
                                FvoiceStates[v].FextFromVolL := voice.ExtInitVolL;
                                FvoiceStates[v].FextToVolL := voice.ExtInitVolL;
                                FvoiceStates[v].FextFromVolR := voice.ExtInitVolR;
                                FvoiceStates[v].FextToVolR := voice.ExtInitVolR;
                            end;
                        end;
                        // Advance glide countdown
                        if FvoiceStates[v].FextGlide > 0 then
                        begin
                            if FvoiceStates[v].FextGlide >= Cardinal(BB_UPDATE_PERIOD) then
                                Dec(FvoiceStates[v].FextGlide, BB_UPDATE_PERIOD)
                            else
                                FvoiceStates[v].FextGlide := 0;
                        end;
                    end
                    else
                    begin
                    ce := FvoiceStates[v].FcurEntry;

                    // Clamp out-of-bounds entry
                    if ce >= voice.EntryCount then
                    begin
                        resetAllVoiceEntries;
                        ce := 0;
                    end;

                    // Walk backward if sample count is before current entry
                    while (ce > 0) and (FcurrentSampleCount < voice.getEntry(ce).absoluteStart) do
                    begin
                        Dec(ce);
                    end;

                    // Walk forward if sample count is past current entry
                    while FcurrentSampleCount > voice.getEntry(ce).absoluteEnd do
                    begin
                        Inc(ce);
                        if ce >= voice.EntryCount then
                        begin
                            FcurrentSampleCount := 0;
                            resetAllVoiceEntries;
                            ce := 0;
                            Dec(FcurrentLoop);
                            if FcurrentLoop <= 0 then
                                Fcompleted := True;
                            Break;
                        end;
                    end;

                    FvoiceStates[v].FcurEntry := ce;

                    // Signal processing only for unmuted voices
                    if not FvoiceStates[v].Fmuted then
                    begin
                        entry := voice.getEntry(ce);

                        // Interpolation factor [0..1] within current entry
                        if entry.duration > 0 then
                            factor := (FcurrentSampleCount - entry.absoluteStart) /
                                      (entry.duration * BB_AUDIOSAMPLERATE)
                        else
                            factor := 0;

                        // Compute current volumes
                        volL := entry.volLstart + entry.volLspread * factor;
                        volR := entry.volRstart + entry.volRspread * factor;
                        if FvoiceStates[v].FoverrideVolL >= 0 then volL := FvoiceStates[v].FoverrideVolL;
                        if FvoiceStates[v].FoverrideVolR >= 0 then volR := FvoiceStates[v].FoverrideVolR;
                        FvoiceStates[v].FcurVolL := volL;
                        FvoiceStates[v].FcurVolR := volR;

                        case voice.VoiceType of
                            vtBinaural:
                            begin
                                basefreq := entry.basefreqStart + entry.basefreqSpread * factor;
                                if FvoiceStates[v].FoverrideBasefreq >= 0 then basefreq := FvoiceStates[v].FoverrideBasefreq;
                                FvoiceStates[v].FcurBasefreq := basefreq;

                                beatfreqHalf := entry.beatfreqHalfStart + entry.beatfreqHalfSpread * factor;
                                if FvoiceStates[v].FoverrideBeatfreq >= 0 then
                                    beatfreqHalf := FvoiceStates[v].FoverrideBeatfreq / 2;
                                FvoiceStates[v].FcurBeatfreq := beatfreqHalf * 2;

                                FvoiceStates[v].FcurBeatfreqLfactor := (basefreq + beatfreqHalf) * BB_SAMPLE_FACTOR;
                                FvoiceStates[v].FcurBeatfreqRfactor := (basefreq - beatfreqHalf) * BB_SAMPLE_FACTOR;
                            end;

                            vtPCM:
                            begin
                                if Length(FvoiceStates[v].FpcmData) > 0 then
                                begin
                                    if FcurrentSampleCount >= entry.absoluteStart then
                                        FvoiceStates[v].FpcmPos := FcurrentSampleCount - entry.absoluteStart
                                    else
                                        FvoiceStates[v].FpcmPos := 0;
                                end;
                            end;

                            vtIsoPulse, vtIsoPulseAlt:
                            begin
                                basefreq := entry.basefreqStart + entry.basefreqSpread * factor;
                                if FvoiceStates[v].FoverrideBasefreq >= 0 then basefreq := FvoiceStates[v].FoverrideBasefreq;
                                FvoiceStates[v].FcurBasefreq := basefreq;

                                oldBeatfreq := FvoiceStates[v].FcurBeatfreq;
                                newBeatfreq := (entry.beatfreqHalfStart + entry.beatfreqHalfSpread * factor) * 2;
                                if FvoiceStates[v].FoverrideBeatfreq >= 0 then newBeatfreq := FvoiceStates[v].FoverrideBeatfreq;
                                if newBeatfreq < 0.0001 then newBeatfreq := 0.0001;
                                FvoiceStates[v].FcurBeatfreq := newBeatfreq;

                                if Abs(oldBeatfreq - newBeatfreq) > 1e-9 then
                                begin
                                    if FvoiceStates[v].FphaseSampleCountStart > 0 then
                                        phaseFactor := FvoiceStates[v].FphaseSampleCount /
                                                       FvoiceStates[v].FphaseSampleCountStart
                                    else
                                        phaseFactor := 0;
                                    FvoiceStates[v].FphaseSampleCountStart := Round(BB_AUDIOSAMPLERATE / 2.0 / newBeatfreq);
                                    FvoiceStates[v].FphaseSampleCount := Round(FvoiceStates[v].FphaseSampleCountStart * phaseFactor);
                                end;

                                FvoiceStates[v].FcurBeatfreqLfactor := basefreq * BB_SAMPLE_FACTOR;
                                FvoiceStates[v].FcurBeatfreqRfactor := basefreq * BB_SAMPLE_FACTOR;
                            end;

                            vtWaterdrops:
                            begin
                                FvoiceStates[v].FcurBasefreq := entry.basefreqStart + entry.basefreqSpread * factor;
                                if FvoiceStates[v].FdropCount = 0 then
                                    waterVoiceInit(FvoiceStates[v], entry.beatfreqHalfStart);
                                if dropMother = nil then
                                    dropMother := getDropMother;
                                waterStep(FvoiceStates[v], dropMother, BB_DROPLEN, 8.0);
                            end;

                            vtRain:
                            begin
                                FvoiceStates[v].FcurBasefreq := entry.basefreqStart + entry.basefreqSpread * factor;
                                if FvoiceStates[v].FdropCount = 0 then
                                    waterVoiceInit(FvoiceStates[v], entry.beatfreqHalfStart);
                                if rainMother = nil then
                                    rainMother := getRainMother;
                                waterStep(FvoiceStates[v], rainMother, BB_RAINLEN, 0.15);
                            end;
                        end; // case
                    end; // if not muted (periodic)
                    end; // else normal voice
                end; // if updateperiod = 0

                // ===== PER-SAMPLE SYNTHESIS =====
                if not FvoiceStates[v].Fmuted then
                begin
                    sampleL := 0;
                    sampleR := 0;

                    case voice.VoiceType of
                        vtBinaural:
                        begin
                            FvoiceStates[v].FsinPosL := FvoiceStates[v].FsinPosL + FvoiceStates[v].FcurBeatfreqLfactor;
                            if FvoiceStates[v].FsinPosL >= BB_TWO_PI then
                                FvoiceStates[v].FsinPosL := FvoiceStates[v].FsinPosL - BB_TWO_PI;
                            FvoiceStates[v].FsinPosR := FvoiceStates[v].FsinPosR + FvoiceStates[v].FcurBeatfreqRfactor;
                            if FvoiceStates[v].FsinPosR >= BB_TWO_PI then
                                FvoiceStates[v].FsinPosR := FvoiceStates[v].FsinPosR - BB_TWO_PI;
                            sampleL := sin(FvoiceStates[v].FsinPosL) * BB_SIN_SCALER;
                            sampleR := sin(FvoiceStates[v].FsinPosR) * BB_SIN_SCALER;
                        end;

                        vtPinkNoise:
                        begin
                            sampleL := bbLoPass(FvoiceStates[v].FnoiseL, SarLongInt(bbRand, 15));
                            sampleR := bbLoPass(FvoiceStates[v].FnoiseR, SarLongInt(bbRand, 15));
                        end;

                        vtPCM:
                        begin
                            if Length(FvoiceStates[v].FpcmData) > 0 then
                            begin
                                if FvoiceStates[v].FpcmPos < Cardinal(Length(FvoiceStates[v].FpcmData)) then
                                begin
                                    sampleL := SmallInt(FvoiceStates[v].FpcmData[FvoiceStates[v].FpcmPos] shr 16);
                                    sampleR := SmallInt(FvoiceStates[v].FpcmData[FvoiceStates[v].FpcmPos]);
                                    Inc(FvoiceStates[v].FpcmPos);
                                end;
                            end;
                        end;

                        vtIsoPulse, vtIsoPulseAlt:
                        begin
                            FvoiceStates[v].FsinPosL := FvoiceStates[v].FsinPosL + FvoiceStates[v].FcurBeatfreqLfactor;
                            if FvoiceStates[v].FsinPosL >= BB_TWO_PI then
                                FvoiceStates[v].FsinPosL := FvoiceStates[v].FsinPosL - BB_TWO_PI;
                            FvoiceStates[v].FsinPosR := FvoiceStates[v].FsinPosL;

                            Dec(FvoiceStates[v].FphaseSampleCount);
                            if FvoiceStates[v].FphaseSampleCount < 1 then
                            begin
                                FvoiceStates[v].FphaseSampleCount := FvoiceStates[v].FphaseSampleCountStart;
                                if FvoiceStates[v].FphaseFlag <> 0 then
                                    FvoiceStates[v].FphaseFlag := 0
                                else
                                    FvoiceStates[v].FphaseFlag := 1;
                                FvoiceStates[v].FphaseEnvelope := 0;
                            end;

                            sampleL := sin(FvoiceStates[v].FsinPosL) * BB_SIN_SCALER;

                            if FvoiceStates[v].FphaseFlag <> 0 then
                            begin
                                sampleL := sampleL * (1.0 - FvoiceStates[v].FphaseEnvelope);
                                if voice.VoiceType = vtIsoPulse then
                                    sampleR := sampleL
                                else
                                    sampleR := sin(FvoiceStates[v].FsinPosR) * BB_SIN_SCALER * FvoiceStates[v].FphaseEnvelope;
                            end
                            else
                            begin
                                sampleL := sampleL * FvoiceStates[v].FphaseEnvelope;
                                if voice.VoiceType = vtIsoPulse then
                                    sampleR := sampleL
                                else
                                    sampleR := sin(FvoiceStates[v].FsinPosR) * BB_SIN_SCALER * (1.0 - FvoiceStates[v].FphaseEnvelope);
                            end;

                            FvoiceStates[v].FphaseEnvelope := FvoiceStates[v].FphaseEnvelope + 0.01;
                            if FvoiceStates[v].FphaseEnvelope > 1.0 then
                                FvoiceStates[v].FphaseEnvelope := 1.0;
                        end;

                        vtWaterdrops, vtRain:
                        begin
                            // Water is computed in periodic section; reuse cached value
                            sampleL := FvoiceStates[v].FwaterMixL;
                            sampleR := FvoiceStates[v].FwaterMixR;
                        end;
                    end; // case voice type

                    // Mono mixing
                    if voice.Mono then
                    begin
                        sampleL := (sampleL + sampleR) * 0.5;
                        sampleR := sampleL;
                    end;

                    sumL := sumL + sampleL * FvoiceStates[v].FcurVolL;
                    sumR := sumR + sampleR * FvoiceStates[v].FcurVolR;
                end; // if not muted (per-sample)
            end; // for each voice
        end; // if not paused and not completed

        // Write stereo 16-bit output
        outL := SmallInt(Max(-32767, Min(32767, Round(sumL * FmasterVolLeft))));
        outR := SmallInt(Max(-32767, Min(32767, Round(sumR * FmasterVolRight))));

        if not FstereoSwap then
        begin
            pOut^ := outL;
            Inc(pOut);
            pOut^ := outR;
            Inc(pOut);
        end
        else
        begin
            pOut^ := outR;
            Inc(pOut);
            pOut^ := outL;
            Inc(pOut);
        end;

        // Advance sample counter every BB_UPDATE_PERIOD samples.
        // Only while actually playing: the audio callback keeps pulling frames when paused (it
        // just gets silence, since the synthesis block above is skipped), so advancing here made
        // the playback clock run through the pause. Resuming then jumped forward by exactly how
        // long the pause lasted (measured 2026-07-15: paused at 70.025, resumed at 72.343).
        if FupdatePeriod = 0 then
        begin
            FupdatePeriod := BB_UPDATE_PERIOD;
            if not Fpaused and not Fcompleted then
                Inc(FcurrentSampleCount, BB_UPDATE_PERIOD);
        end;
    end; // for each frame
end;

{ Real-time control methods }

procedure TGnauralSynth.pause;
begin
    Fpaused := True;
end;

procedure TGnauralSynth.resume;
begin
    Fpaused := False;
end;

function TGnauralSynth.isPaused: Boolean;
begin
    Result := Fpaused;
end;

procedure TGnauralSynth.seek(aTimeSeconds: Double);
begin
    FseekTarget := Round(aTimeSeconds * BB_AUDIOSAMPLERATE);
end;

procedure TGnauralSynth.setMasterVolume(aVolLeft, aVolRight: Double);
begin
    FmasterVolLeft := aVolLeft;
    FmasterVolRight := aVolRight;
end;

procedure TGnauralSynth.muteVoice(aVoiceIndex: Integer; aMuted: Boolean);
begin
    if (aVoiceIndex >= 0) and (aVoiceIndex < FvoiceCount) then
        FvoiceStates[aVoiceIndex].Fmuted := LongBool(aMuted);
end;

procedure TGnauralSynth.setVoiceBeatFreq(aVoiceIndex: Integer; aBeatFreq: Double);
begin
    if (aVoiceIndex >= 0) and (aVoiceIndex < FvoiceCount) then
        FvoiceStates[aVoiceIndex].FoverrideBeatfreq := aBeatFreq;
end;

procedure TGnauralSynth.setVoiceBaseFreq(aVoiceIndex: Integer; aBaseFreq: Double);
begin
    if (aVoiceIndex >= 0) and (aVoiceIndex < FvoiceCount) then
        FvoiceStates[aVoiceIndex].FoverrideBasefreq := aBaseFreq;
end;

procedure TGnauralSynth.setVoiceVolume(aVoiceIndex: Integer; aVolL, aVolR: Double);
begin
    if (aVoiceIndex >= 0) and (aVoiceIndex < FvoiceCount) then
    begin
        FvoiceStates[aVoiceIndex].FoverrideVolL := aVolL;
        FvoiceStates[aVoiceIndex].FoverrideVolR := aVolR;
    end;
end;

function TGnauralSynth.getPlaybackPosition: Double;
var
    pendingSeek : Int64;
begin
    // seek() only REQUESTS a seek (FseekTarget); the render loop applies it to FcurrentSampleCount
    // on its next pass. Until then FcurrentSampleCount still holds the pre-seek position, and the
    // control loop in GnauralApp would report THAT as playback progress — the host then saw the
    // playhead jump back to the old spot for one tick before the seek took effect
    // (measured 2026-07-15: seek to 16.494 emitted 0 -> 16.494 -> 0.077 -> 16.623).
    // While a seek is pending, the target IS the playback position as far as the outside world is
    // concerned. Read the field once: the render thread may clear it at any moment.
    pendingSeek := FseekTarget;
    if pendingSeek >= 0 then
        Result := pendingSeek / BB_AUDIOSAMPLERATE
    else
        Result := FcurrentSampleCount / BB_AUDIOSAMPLERATE;
end;

function TGnauralSynth.isCompleted: Boolean;
begin
    Result := Fcompleted;
end;

function TGnauralSynth.getVoiceCount: Integer;
begin
    Result := FvoiceCount;
end;

procedure TGnauralSynth.pushExternalEntry(aVoiceIndex: Integer;
    aBaseFreq, aBeatFreq, aVolL, aVolR: Double;
    aTransitionTimeSec, aDurationSec: Double);
var
    glideSamples, durSamples: Cardinal;
begin
    if (aVoiceIndex < 0) or (aVoiceIndex >= FvoiceCount) then
        Exit;
    if not Fschedule.getVoice(aVoiceIndex).IsExternalStdin then
        Exit;

    if aTransitionTimeSec > 0 then
        glideSamples := Round(aTransitionTimeSec * BB_AUDIOSAMPLERATE)
    else
        glideSamples := 0;
    if aDurationSec > 0 then
        durSamples := Round(aDurationSec * BB_AUDIOSAMPLERATE)
    else
        durSamples := 0;

    // Seqlock write: odd seq = write in progress, even seq = ready
    TInterlocked.Increment(FvoiceStates[aVoiceIndex].FextPendSeq);
    ReadWriteBarrier;                              // prevent data writes reordering before the odd-seq store
    FvoiceStates[aVoiceIndex].FextPendBase  := aBaseFreq;
    FvoiceStates[aVoiceIndex].FextPendBeat  := aBeatFreq;
    FvoiceStates[aVoiceIndex].FextPendVolL  := aVolL;
    FvoiceStates[aVoiceIndex].FextPendVolR  := aVolR;
    FvoiceStates[aVoiceIndex].FextPendGlide := glideSamples;
    FvoiceStates[aVoiceIndex].FextPendDur   := durSamples;
    ReadWriteBarrier;
    TInterlocked.Increment(FvoiceStates[aVoiceIndex].FextPendSeq);
end;

end.
