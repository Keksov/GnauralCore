unit GnauralAudioFileReader;

{$mode objfpc}{$H+}

interface

uses
    SysUtils,
    GnauralWavReader;

type
    TIntegerDynArray = GnauralWavReader.TIntegerDynArray;

{ Loads an audio file (WAV, OGG, FLAC, etc.) and returns packed stereo
  samples as Integer array: (Left shl 16) or (Right and $FFFF).
  Resamples to 44100 Hz if necessary.
  For WAV files uses the built-in reader; for other formats uses libsndfile
  (sndfile.dll) which is loaded on first use. }
function  loadAudioFile(const aFileName: string): TIntegerDynArray;

implementation

uses
    Classes,
    ctypes,
    uos_libsndfile;

const
    TARGET_RATE             = 44100;

var
    sndfileLoaded           : Boolean = False;
    sndfileChecked          : Boolean = False;

function ensureSndfileLoaded: Boolean;
begin
    if sndfileChecked then
    begin
        Result := sndfileLoaded;
        Exit;
    end;
    sndfileChecked := True;
    sndfileLoaded := sf_Load('');
    Result := sndfileLoaded;
end;

function loadViaSndfile(const aFileName: string): TIntegerDynArray;
var
    info: TSF_INFO;
    hnd: TSNDFILE_HANDLE;
    ch: Integer;
    frames: Int64;
    buf: PSmallInt;
    i, n: Integer;
    sL, sR: SmallInt;
    ratio: Double;
    idx0, idx1: Integer;
    frac: Double;
    srcIdx: Double;
    srcL, srcR: PSmallInt;
    srcL0, srcR0, srcL1, srcR1: SmallInt;
    srcCount: Integer;
begin
    Result := nil;

    if not ensureSndfileLoaded then
        raise Exception.Create('sndfile.dll not available; cannot decode: ' + aFileName);

    FillChar(info, SizeOf(info), 0);
    hnd := sf_open(aFileName, SFM_READ, info);
    if hnd = nil then
        raise Exception.CreateFmt('Failed to open audio file: %s', [aFileName]);

    try
        ch := info.channels;
        frames := info.frames;
        if (ch < 1) or (ch > 2) then
            raise Exception.CreateFmt('Unsupported channel count (%d): %s', [ch, aFileName]);
        if frames < 1 then
            raise Exception.CreateFmt('Empty audio file: %s', [aFileName]);

        // Read all frames as interleaved 16-bit samples
        GetMem(buf, frames * ch * SizeOf(SmallInt));
        try
            sf_readf_short(hnd, ctypes.pcshort(buf), frames);

            // Deinterleave into separate L/R buffers
            srcCount := Integer(frames);
            GetMem(srcL, srcCount * SizeOf(SmallInt));
            GetMem(srcR, srcCount * SizeOf(SmallInt));
            try
                if ch = 2 then
                begin
                    for i := 0 to srcCount - 1 do
                    begin
                        srcL[i] := buf[i * 2];
                        srcR[i] := buf[i * 2 + 1];
                    end;
                end
                else
                begin
                    for i := 0 to srcCount - 1 do
                    begin
                        srcL[i] := buf[i];
                        srcR[i] := buf[i];
                    end;
                end;

                // Resample to TARGET_RATE if needed
                if Cardinal(info.samplerate) = TARGET_RATE then
                begin
                    n := srcCount;
                    SetLength(Result, n);
                    for i := 0 to n - 1 do
                        Result[i] := (Integer(srcL[i]) shl 16) or (Integer(srcR[i]) and $FFFF);
                end
                else
                begin
                    ratio := Double(info.samplerate) / Double(TARGET_RATE);
                    n := Trunc(Double(srcCount) / ratio);
                    if n < 1 then
                        n := 1;
                    SetLength(Result, n);

                    for i := 0 to n - 1 do
                    begin
                        srcIdx := Double(i) * ratio;
                        idx0 := Trunc(srcIdx);
                        frac := srcIdx - idx0;
                        idx1 := idx0 + 1;
                        if idx0 >= srcCount then
                            idx0 := srcCount - 1;
                        if idx1 >= srcCount then
                            idx1 := srcCount - 1;

                        srcL0 := srcL[idx0];
                        srcR0 := srcR[idx0];
                        srcL1 := srcL[idx1];
                        srcR1 := srcR[idx1];

                        sL := SmallInt(Round(Double(srcL0) + frac * (Double(srcL1) - Double(srcL0))));
                        sR := SmallInt(Round(Double(srcR0) + frac * (Double(srcR1) - Double(srcR0))));

                        Result[i] := (Integer(sL) shl 16) or (Integer(sR) and $FFFF);
                    end;
                end;

            finally
                FreeMem(srcR);
                FreeMem(srcL);
            end;

        finally
            FreeMem(buf);
        end;

    finally
        sf_close(hnd);
    end;
end;

function loadAudioFile(const aFileName: string): TIntegerDynArray;
var
    ext: string;
begin
    if not FileExists(aFileName) then
        raise Exception.CreateFmt('Audio file not found: %s', [aFileName]);

    ext := LowerCase(ExtractFileExt(aFileName));

    if ext = '.wav' then
        Result := loadWavFile(aFileName)
    else
        Result := loadViaSndfile(aFileName);
end;

end.
