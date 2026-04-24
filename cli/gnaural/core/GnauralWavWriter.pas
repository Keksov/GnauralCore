unit GnauralWavWriter;

{$mode objfpc}{$H+}

interface

uses
    SysUtils, Classes,
    GnauralSynth,
    GnauralVoiceSynth;

type
    {***************************************************************************
     * TWavWriter
     *   Renders a TGnauralSynth to a 16-bit stereo 44100 Hz WAV file.
     *   Calls fillBuffer in a tight loop (offline, faster than real-time).
     ***************************************************************************}
    TWavWriter = class
private
    Fsynth                  : TGnauralSynth;

    procedure   writeHeader(aStream: TStream; aDataSize: Cardinal);

public
    constructor Create(aSynth: TGnauralSynth);
    destructor  Destroy; override;

    procedure   renderToFile(const aFileName: string);
    end;

implementation

const
    WAV_SAMPLE_RATE         = BB_AUDIOSAMPLERATE;   // 44100
    WAV_CHANNELS            = 2;
    WAV_BITS_PER_SAMPLE     = 16;
    WAV_BLOCK_ALIGN         = WAV_CHANNELS * (WAV_BITS_PER_SAMPLE div 8); // 4
    WAV_BYTE_RATE           = WAV_SAMPLE_RATE * WAV_BLOCK_ALIGN;          // 176400
    RENDER_FRAMES           = 4096;

{ TWavWriter }

constructor TWavWriter.Create(aSynth: TGnauralSynth);
begin
    inherited Create;
    Fsynth := aSynth;
end;

destructor TWavWriter.Destroy;
begin
    inherited Destroy;
end;

procedure TWavWriter.writeHeader(aStream: TStream; aDataSize: Cardinal);
var
    w16: Word;
    d32: Cardinal;
begin
    // RIFF header
    aStream.WriteBuffer('RIFF', 4);
    d32 := 36 + aDataSize;
    aStream.WriteBuffer(d32, 4);
    aStream.WriteBuffer('WAVE', 4);

    // fmt sub-chunk
    aStream.WriteBuffer('fmt ', 4);
    d32 := 16;                          // PCM sub-chunk size
    aStream.WriteBuffer(d32, 4);
    w16 := 1;                           // PCM format
    aStream.WriteBuffer(w16, 2);
    w16 := WAV_CHANNELS;
    aStream.WriteBuffer(w16, 2);
    d32 := WAV_SAMPLE_RATE;
    aStream.WriteBuffer(d32, 4);
    d32 := WAV_BYTE_RATE;
    aStream.WriteBuffer(d32, 4);
    w16 := WAV_BLOCK_ALIGN;
    aStream.WriteBuffer(w16, 2);
    w16 := WAV_BITS_PER_SAMPLE;
    aStream.WriteBuffer(w16, 2);

    // data sub-chunk header
    aStream.WriteBuffer('data', 4);
    aStream.WriteBuffer(aDataSize, 4);
end;

procedure TWavWriter.renderToFile(const aFileName: string);
var
    fs: TFileStream;
    buf: array[0..RENDER_FRAMES * WAV_CHANNELS - 1] of SmallInt;
    dataSize: Cardinal;
    chunkBytes: Cardinal;
begin
    fs := TFileStream.Create(aFileName, fmCreate);
    try
        // Write placeholder header (will be patched at end)
        writeHeader(fs, 0);

        dataSize := 0;
        while not Fsynth.isCompleted do
        begin
            Fsynth.fillBuffer(@buf[0], RENDER_FRAMES);
            chunkBytes := RENDER_FRAMES * WAV_BLOCK_ALIGN;
            fs.WriteBuffer(buf, chunkBytes);
            Inc(dataSize, chunkBytes);
        end;

        // Patch header with actual data size
        fs.Position := 0;
        writeHeader(fs, dataSize);
    finally
        fs.Free;
    end;
end;

end.
