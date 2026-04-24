unit GnauralAudioWriter;

{$mode objfpc}{$H+}

interface

uses
    SysUtils,
    GnauralSynth;

procedure renderSynthToAudioFile(aSynth: TGnauralSynth;
    const aFileName: string);
procedure convertAudioFile(const aSourceFileName: string;
    const aTargetFileName: string);

implementation

uses
    ctypes,
    GnauralAudioFileReader,
    GnauralVoiceSynth,
    GnauralWavWriter,
    uos_libsndfile;

const
    AUDIO_CHANNELS          = 2;
    AUDIO_SAMPLE_RATE       = BB_AUDIOSAMPLERATE;
    AUDIO_SAMPLE_SUBTYPE    = SF_FORMAT_PCM_16;
    AUDIO_RENDER_FRAMES     = 4096;

var
    GsndfileChecked         : Boolean = False;
    GsndfileLoaded          : Boolean = False;

function ensureSndfileLoaded: Boolean;
begin
    if not GsndfileChecked then
    begin
        GsndfileLoaded := sf_IsLoaded or sf_Load('');
        GsndfileChecked := True;
    end;

    Result := GsndfileLoaded;
end;

function getAudioOutputFormat(const aFileName: string): Integer;
var
    ext: string;
begin
    ext := LowerCase(ExtractFileExt(aFileName));
    if ext = '.wav' then
        Result := SF_FORMAT_WAV or AUDIO_SAMPLE_SUBTYPE
    else if ext = '.flac' then
        Result := SF_FORMAT_FLAC or AUDIO_SAMPLE_SUBTYPE
    else
        raise Exception.CreateFmt('Unsupported audio output format: %s',
            [aFileName]);
end;

procedure openSndfileForWrite(const aFileName: string; aFormat: Integer;
    out aHandle: TSNDFILE_HANDLE; out aInfo: TSF_INFO);
begin
    if not ensureSndfileLoaded then
        raise Exception.Create('Failed to initialize libsndfile.');

    FillChar(aInfo, SizeOf(aInfo), 0);
    aInfo.samplerate := AUDIO_SAMPLE_RATE;
    aInfo.channels := AUDIO_CHANNELS;
    aInfo.format := aFormat;

    if sf_format_check(aInfo) = SF_FALSE then
        raise Exception.CreateFmt('Unsupported audio output format: %s',
            [aFileName]);

    aHandle := sf_open(aFileName, SFM_WRITE, aInfo);
    if aHandle = nil then
        raise Exception.CreateFmt('Failed to open audio output file: %s',
            [aFileName]);
end;

procedure writePackedSamplesToSndfile(const aFileName: string;
    const aSamples: GnauralAudioFileReader.TIntegerDynArray; aFormat: Integer);
var
    i: Integer;
    sample: Integer;
    srcIndex: Integer;
    frameCount: Integer;
    framesWritten: Int64;
    sndfileHandle: TSNDFILE_HANDLE;
    sndfileInfo: TSF_INFO;
    pcmBuffer: array[0..AUDIO_RENDER_FRAMES * AUDIO_CHANNELS - 1] of SmallInt;
begin
    sndfileHandle := nil;
    openSndfileForWrite(aFileName, aFormat, sndfileHandle, sndfileInfo);
    try
        srcIndex := 0;
        while srcIndex < Length(aSamples) do
        begin
            frameCount := Length(aSamples) - srcIndex;
            if frameCount > AUDIO_RENDER_FRAMES then
                frameCount := AUDIO_RENDER_FRAMES;

            for i := 0 to frameCount - 1 do
            begin
                sample := aSamples[srcIndex + i];
                pcmBuffer[i * AUDIO_CHANNELS] := SmallInt((sample shr 16)
                    and $FFFF);
                pcmBuffer[(i * AUDIO_CHANNELS) + 1] := SmallInt(sample
                    and $FFFF);
            end;

            framesWritten := sf_writef_short(sndfileHandle,
                ctypes.pcshort(@pcmBuffer[0]), frameCount);
            if framesWritten <> frameCount then
                raise Exception.CreateFmt('Failed while writing audio output: %s',
                    [aFileName]);

            Inc(srcIndex, frameCount);
        end;

        sf_write_sync(sndfileHandle);
    finally
        if sndfileHandle <> nil then
            sf_close(sndfileHandle);
    end;
end;

procedure writeSynthToSndfile(aSynth: TGnauralSynth; const aFileName: string;
    aFormat: Integer);
var
    framesWritten: Int64;
    sndfileHandle: TSNDFILE_HANDLE;
    sndfileInfo: TSF_INFO;
    pcmBuffer: array[0..AUDIO_RENDER_FRAMES * AUDIO_CHANNELS - 1] of SmallInt;
begin
    sndfileHandle := nil;
    openSndfileForWrite(aFileName, aFormat, sndfileHandle, sndfileInfo);
    try
        while not aSynth.isCompleted do
        begin
            aSynth.fillBuffer(@pcmBuffer[0], AUDIO_RENDER_FRAMES);
            framesWritten := sf_writef_short(sndfileHandle,
                ctypes.pcshort(@pcmBuffer[0]), AUDIO_RENDER_FRAMES);
            if framesWritten <> AUDIO_RENDER_FRAMES then
                raise Exception.CreateFmt('Failed while writing audio output: %s',
                    [aFileName]);
        end;

        sf_write_sync(sndfileHandle);
    finally
        if sndfileHandle <> nil then
            sf_close(sndfileHandle);
    end;
end;

procedure renderSynthToAudioFile(aSynth: TGnauralSynth;
    const aFileName: string);
var
    wavWriter: TWavWriter;
    format: Integer;
begin
    format := getAudioOutputFormat(aFileName);
    if (format and SF_FORMAT_TYPEMASK) = SF_FORMAT_WAV then
    begin
        wavWriter := TWavWriter.Create(aSynth);
        try
            wavWriter.renderToFile(aFileName);
        finally
            FreeAndNil(wavWriter);
        end;
        Exit;
    end;

    writeSynthToSndfile(aSynth, aFileName, format);
end;

procedure convertAudioFile(const aSourceFileName: string;
    const aTargetFileName: string);
var
    format: Integer;
    audioData: GnauralAudioFileReader.TIntegerDynArray;
begin
    format := getAudioOutputFormat(aTargetFileName);
    audioData := loadAudioFile(aSourceFileName);
    writePackedSamplesToSndfile(aTargetFileName, audioData, format);
end;

end.