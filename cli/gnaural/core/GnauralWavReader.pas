unit GnauralWavReader;

{$mode objfpc}{$H+}

interface

uses
    SysUtils, Classes;

type
    TIntegerDynArray = array of Integer;

{ Loads a 16-bit PCM WAV file (mono or stereo, any sample rate) and returns
  packed stereo samples as Integer array: (Left shl 16) or (Right and $FFFF).
  Resamples to 44100 Hz if necessary using linear interpolation. }
function  loadWavFile(const aFileName: string): TIntegerDynArray;

implementation

const
    TARGET_RATE             = 44100;

type
    TRiffHeader = packed record
        riffId              : array[0..3] of AnsiChar;
        fileSize            : Cardinal;
        waveId              : array[0..3] of AnsiChar;
    end;

    TChunkHeader = packed record
        chunkId             : array[0..3] of AnsiChar;
        chunkSize           : Cardinal;
    end;

    TFmtChunk = packed record
        audioFormat         : Word;
        numChannels         : Word;
        sampleRate          : Cardinal;
        byteRate            : Cardinal;
        blockAlign          : Word;
        bitsPerSample       : Word;
    end;

function loadWavFile(const aFileName: string): TIntegerDynArray;
var
    fs: TFileStream;
    riff: TRiffHeader;
    chunk: TChunkHeader;
    fmt: TFmtChunk;
    id: string;
    pos: Int64;
    fmtFound, dataFound: Boolean;
    rawSize, rawCount: Cardinal;
    rawBuf: PSmallInt;
    i, n: Integer;
    sL, sR: SmallInt;
    ratio: Double;
    srcIdx: Double;
    idx0, idx1: Integer;
    frac: Double;
    srcL0, srcR0, srcL1, srcR1: SmallInt;
    srcCount: Integer;
    srcL, srcR: PSmallInt;
begin
    Result := nil;

    if not FileExists(aFileName) then
        raise Exception.CreateFmt('WAV file not found: %s', [aFileName]);

    fs := TFileStream.Create(aFileName, fmOpenRead or fmShareDenyNone);
    try
        // Read RIFF header
        if fs.Size < SizeOf(TRiffHeader) then
            raise Exception.Create('WAV file too small');
        fs.ReadBuffer(riff, SizeOf(riff));
        if (riff.riffId <> 'RIFF') or (riff.waveId <> 'WAVE') then
            raise Exception.CreateFmt('Not a valid WAV file: %s', [aFileName]);

        fmtFound := False;
        dataFound := False;
        FillChar(fmt, SizeOf(fmt), 0);
        rawBuf := nil;
        rawSize := 0;

        // Walk chunks
        while fs.Position < fs.Size - SizeOf(TChunkHeader) + 1 do
        begin
            fs.ReadBuffer(chunk, SizeOf(chunk));
            id := string(chunk.chunkId[0]) + string(chunk.chunkId[1]) +
                  string(chunk.chunkId[2]) + string(chunk.chunkId[3]);

            if id = 'fmt ' then
            begin
                if chunk.chunkSize < SizeOf(TFmtChunk) then
                    raise Exception.Create('WAV fmt chunk too small');
                fs.ReadBuffer(fmt, SizeOf(TFmtChunk));
                // Skip extra fmt bytes
                if chunk.chunkSize > SizeOf(TFmtChunk) then
                    fs.Seek(Int64(chunk.chunkSize) - SizeOf(TFmtChunk), soCurrent);
                fmtFound := True;
            end
            else if id = 'data' then
            begin
                if not fmtFound then
                    raise Exception.Create('WAV data chunk before fmt chunk');
                rawSize := chunk.chunkSize;
                GetMem(rawBuf, rawSize);
                fs.ReadBuffer(rawBuf^, rawSize);
                dataFound := True;
                Break;
            end
            else
            begin
                // Skip unknown chunk (pad to even)
                pos := Int64(chunk.chunkSize);
                if pos mod 2 = 1 then
                    Inc(pos);
                fs.Seek(pos, soCurrent);
            end;
        end;

        if not fmtFound then
            raise Exception.CreateFmt('WAV file missing fmt chunk: %s', [aFileName]);
        if not dataFound then
            raise Exception.CreateFmt('WAV file missing data chunk: %s', [aFileName]);
        if fmt.audioFormat <> 1 then
            raise Exception.CreateFmt('WAV file is not PCM format (format=%d): %s', [fmt.audioFormat, aFileName]);
        if (fmt.bitsPerSample <> 16) then
            raise Exception.CreateFmt('WAV file is not 16-bit (bits=%d): %s', [fmt.bitsPerSample, aFileName]);
        if (fmt.numChannels < 1) or (fmt.numChannels > 2) then
            raise Exception.CreateFmt('WAV file has unsupported channel count (%d): %s', [fmt.numChannels, aFileName]);

        try
            rawCount := rawSize div (fmt.numChannels * 2);  // 2 bytes per sample

            // Decode raw PCM into separate L/R channels
            GetMem(srcL, rawCount * SizeOf(SmallInt));
            GetMem(srcR, rawCount * SizeOf(SmallInt));
            try
                if fmt.numChannels = 2 then
                begin
                    for i := 0 to Integer(rawCount) - 1 do
                    begin
                        srcL[i] := rawBuf[i * 2];
                        srcR[i] := rawBuf[i * 2 + 1];
                    end;
                end
                else
                begin
                    // Mono: duplicate to both channels
                    for i := 0 to Integer(rawCount) - 1 do
                    begin
                        srcL[i] := rawBuf[i];
                        srcR[i] := rawBuf[i];
                    end;
                end;

                srcCount := Integer(rawCount);

                // Resample to TARGET_RATE if needed
                if fmt.sampleRate = TARGET_RATE then
                begin
                    // Direct copy
                    n := srcCount;
                    SetLength(Result, n);
                    for i := 0 to n - 1 do
                        Result[i] := (Integer(srcL[i]) shl 16) or (Integer(srcR[i]) and $FFFF);
                end
                else
                begin
                    // Linear interpolation resample
                    ratio := Double(fmt.sampleRate) / Double(TARGET_RATE);
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
            FreeMem(rawBuf);
        end;

    finally
        fs.Free;
    end;
end;

end.
