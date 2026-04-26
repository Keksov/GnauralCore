unit GnauralAudioOutput;

{$mode objfpc}{$H+}

interface

uses
    SysUtils, CTypes,
    uos_portaudio,
    GnauralSynth;

type
    {***************************************************************************
     * TAudioOutput
     ***************************************************************************}
    TAudioOutput = class
private
    Fsynth                  : TGnauralSynth;
    Fstream                 : PPaStream;
    Finitialized            : Boolean;

public
    constructor Create(aSynth: TGnauralSynth);
    destructor  Destroy; override;

    procedure   start;
    procedure   stop;
    procedure   waitUntilDone;
    end;

implementation

// Standalone cdecl PortAudio callback — calls synth.fillBuffer
function portAudioCallback(
    aInput      : Pointer;
    aOutput     : Pointer;
    aFrameCount : CULong;
    aTimeInfo   : PPaStreamCallbackTimeInfo;
    aStatusFlags: PaStreamCallbackFlags;
    aUserData   : Pointer): CInt32; cdecl;
begin
    TGnauralSynth(aUserData).fillBuffer(aOutput, aFrameCount);
    Result := Ord(paContinue);
end;

{ TAudioOutput }

constructor TAudioOutput.Create(aSynth: TGnauralSynth);
var
    err: PaError;
    dllPath: string;
begin
    inherited Create;
    Fsynth := aSynth;
    Fstream := nil;
    Finitialized := False;

    try
        dllPath := ExtractFilePath(ParamStr(0)) + 'portaudio.dll';
        if not Pa_Load(dllPath) then
            raise Exception.Create('ERROR: Failed to load portaudio.dll from ' + dllPath);

        err := Pa_Initialize();
        if err <> Ord(paNoError) then
            raise Exception.Create('ERROR: Pa_Initialize failed: ' + string(Pa_GetErrorText(err)));

        Finitialized := True;

        err := Pa_OpenDefaultStream(
            @Fstream,
            0,                              // no input channels
            2,                              // stereo output
            paInt16,                        // 16-bit signed samples
            44100,                          // sample rate
            paFramesPerBufferUnspecified,   // let PortAudio choose buffer size
            PaStreamCallback(@portAudioCallback),
            Fsynth                          // userData passed to callback
        );

        if err <> Ord(paNoError) then
            raise Exception.Create('ERROR: Pa_OpenDefaultStream failed: ' + string(Pa_GetErrorText(err)));
    except
        if Fstream <> nil then
        begin
            Pa_CloseStream(Fstream);
            Fstream := nil;
        end;
        if Finitialized then
        begin
            Pa_Terminate();
            Finitialized := False;
        end;
        Pa_Unload;
        raise;
    end;
end;

destructor TAudioOutput.Destroy;
begin
    stop;
    if Fstream <> nil then
    begin
        Pa_CloseStream(Fstream);
        Fstream := nil;
    end;
    if Finitialized then
    begin
        Pa_Terminate();
        Finitialized := False;
    end;
    Pa_Unload;
    inherited Destroy;
end;

procedure TAudioOutput.start;
var
    err: PaError;
begin
    err := Pa_StartStream(Fstream);
    if err <> Ord(paNoError) then
        raise Exception.Create('ERROR: Pa_StartStream failed: ' + string(Pa_GetErrorText(err)));
end;

procedure TAudioOutput.stop;
var
    err: PaError;
begin
    if Fstream <> nil then
    begin
        err := Pa_IsStreamActive(Fstream);
        if err = 1 then
            Pa_StopStream(Fstream);
    end;
end;

procedure TAudioOutput.waitUntilDone;
begin
    while not Fsynth.isCompleted do
        Sleep(100);
end;

end.
