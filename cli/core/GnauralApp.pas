unit GnauralApp;

{$mode objfpc}{$H+}

interface

uses
    SysUtils,
    GnauralSchedule,
    GnauralSynth,
    GnauralAudioOutput,
    GnauralAudioWriter;

type
    {***************************************************************************
     * TGnauralApp
     ***************************************************************************}
    TGnauralApp = class
private
    Fschedule               : TGnauralSchedule;
    Fsynth                  : TGnauralSynth;
    FaudioOutput            : TAudioOutput;
    FloadedFileName         : string;
    // TP3.1: progress is throttled by position advance, not whole seconds. FlastProgressPos is the
    // position at the last emit (-1 = none yet); FprogressIntervalSec is the adaptive step, set per
    // schedule so short loops still get ~PROGRESS_UPDATES_PER_LOOP updates.
    FlastProgressPos        : Double;
    FprogressIntervalSec    : Double;
    FoutputFileName         : string;

    procedure   clearLoadedSchedule;
    procedure   dumpSchedule;
    procedure   emitLoadedEvent;
    procedure   emitPlaybackProgressEvent(aPositionSec: Double; aLoop: Integer);
    procedure   emitPlaybackCompletedEvent;
    procedure   loadScheduleFile(const aFileName: string);
    procedure   printInfo;
    procedure   printUsage;
    procedure   rebuildSynth;
    procedure   runServer;
    procedure   startAudioOutput;
    procedure   stopPlayback(aResetToStart: Boolean = False);

public
    constructor Create;
    destructor  Destroy; override;

    function    run: Integer;
    end;

implementation

uses
    Windows,
    LogCore,
    JsonLogWriter,
    GnauralControlProtocol;

const
    // TP3.1: aim for this many playback_progress updates per loop, clamped to [min, max] seconds.
    // The control loop ticks every 100ms, so 0.1s (10Hz) is the finest achievable; 1s keeps the old
    // rate for long loops (and single-loop files).
    PROGRESS_UPDATES_PER_LOOP = 20;
    PROGRESS_MIN_INTERVAL_SEC = 0.1;
    PROGRESS_MAX_INTERVAL_SEC = 1.0;

{*******************************************************************************
* writeStdoutLine
*******************************************************************************}
procedure writeStdoutLine(const aLine: string);
begin
    WriteLn(aLine);
    Flush(Output);
end;

{*******************************************************************************
* getCommandName
*******************************************************************************}
function getCommandName(aCmdType: TGnauralCmdType): string;
begin
    case aCmdType of
        gctLoad:
            Result := 'load';
        gctStart:
            Result := 'start';
        gctPause:
            Result := 'pause';
        gctResume:
            Result := 'resume';
        gctSeek:
            Result := 'seek';
        gctSetVolume:
            Result := 'set_volume';
        gctMuteVoice:
            Result := 'mute_voice';
        gctStop:
            Result := 'stop';
        gctQuit:
            Result := 'quit';
        gctEntry:
            Result := 'entry';
    else
        Result := 'unknown';
    end;
end;

{*******************************************************************************
* emitCommandAck
*******************************************************************************}
procedure emitCommandAck(aCmdType: TGnauralCmdType; aOk: Boolean;
    const aError: string = '');
begin
    writeStdoutLine(makeGnauralAck(getCommandName(aCmdType), aOk,
        aError));
end;

{*******************************************************************************
* readStdinLine
*******************************************************************************}
function readStdinLine(out aLine: string): Boolean;
begin
    aLine := '';
    if EOF(Input) then
        Exit(False);

    ReadLn(Input, aLine);
    Result := True;
end;

{*******************************************************************************
* tryReadStdinLineWithTimeout
*******************************************************************************}
function tryReadStdinLineWithTimeout(out aLine: string;
    aTimeoutMs: DWORD; out aReachedEof: Boolean): Boolean;
var
    ok: BOOL;
    waitRes: DWORD;
    bytesAvail: DWORD;
    stdinHandle: THandle;
begin
    Result := False;
    aLine := '';
    aReachedEof := False;
    stdinHandle := GetStdHandle(STD_INPUT_HANDLE);

    if stdinHandle = INVALID_HANDLE_VALUE then
    begin
        aReachedEof := True;
        Exit;
    end;

    if GetFileType(stdinHandle) <> FILE_TYPE_PIPE then
    begin
        Result := readStdinLine(aLine);
        aReachedEof := not Result;
        Exit;
    end;

    waitRes := WaitForSingleObject(stdinHandle, aTimeoutMs);
    if waitRes = WAIT_TIMEOUT then
        Exit;

    if waitRes <> WAIT_OBJECT_0 then
    begin
        aReachedEof := True;
        Exit;
    end;

    bytesAvail := 0;
    ok := PeekNamedPipe(stdinHandle, nil, 0, nil, @bytesAvail, nil);
    if not ok then
    begin
        aReachedEof := GetLastError() = ERROR_BROKEN_PIPE;
        Exit;
    end;

    if bytesAvail = 0 then
    begin
        // Some PTY/pipe setups can report WAIT_OBJECT_0 with no readable bytes.
        // Sleep for the caller timeout to avoid a hot spin in server loops.
        if aTimeoutMs > 0 then
            Sleep(aTimeoutMs);
        Exit;
    end;

    Result := readStdinLine(aLine);
    aReachedEof := not Result;
end;

{ TGnauralApp }

constructor TGnauralApp.Create;
begin
    inherited Create;
    Fschedule := nil;
    Fsynth := nil;
    FaudioOutput := nil;
    FloadedFileName := '';
    FlastProgressPos := -1;
    FprogressIntervalSec := PROGRESS_MAX_INTERVAL_SEC;
    FoutputFileName := '';
end;

destructor TGnauralApp.Destroy;
begin
    stopPlayback(False);
    FreeAndNil(Fsynth);
    FreeAndNil(Fschedule);
    inherited Destroy;
end;

{*******************************************************************************
* clearLoadedSchedule
*******************************************************************************}
procedure TGnauralApp.clearLoadedSchedule;
begin
    stopPlayback(False);
    FreeAndNil(Fsynth);
    FreeAndNil(Fschedule);
    FloadedFileName := '';
    FlastProgressPos := -1;
end;

{*******************************************************************************
* rebuildSynth
*******************************************************************************}
procedure TGnauralApp.rebuildSynth;
begin
    stopPlayback(False);
    FreeAndNil(Fsynth);

    if Fschedule = nil then
        Exit;

    Fsynth := TGnauralSynth.Create(Fschedule);

    // TP3.1: pick the progress-emit interval for this schedule. TotalTime is ONE loop, so a short
    // loop (e.g. 0.79s) gets a small interval and thus a smooth cursor; a long loop keeps ~1s.
    FprogressIntervalSec := Fschedule.TotalTime / PROGRESS_UPDATES_PER_LOOP;
    if FprogressIntervalSec < PROGRESS_MIN_INTERVAL_SEC then
        FprogressIntervalSec := PROGRESS_MIN_INTERVAL_SEC;
    if FprogressIntervalSec > PROGRESS_MAX_INTERVAL_SEC then
        FprogressIntervalSec := PROGRESS_MAX_INTERVAL_SEC;
end;

{*******************************************************************************
* stopPlayback
*******************************************************************************}
procedure TGnauralApp.stopPlayback(aResetToStart: Boolean);
begin
    if FaudioOutput <> nil then
    begin
        FaudioOutput.stop;
        FreeAndNil(FaudioOutput);
    end;

    FlastProgressPos := -1;

    if aResetToStart and (Fschedule <> nil) then
        rebuildSynth;
end;

{*******************************************************************************
* loadScheduleFile
*******************************************************************************}
procedure TGnauralApp.loadScheduleFile(const aFileName: string);
begin
    clearLoadedSchedule;

    if not FileExists(aFileName) then
        raise Exception.Create('File not found: ' + aFileName);

    Fschedule := TGnauralSchedule.Create;
    Fschedule.loadFromFile(aFileName);
    if Fschedule.VoiceCount = 0 then
        raise Exception.Create('No voices found in schedule.');

    FloadedFileName := ExpandFileName(aFileName);
    rebuildSynth;
end;

{*******************************************************************************
* dumpSchedule
*******************************************************************************}
procedure TGnauralApp.dumpSchedule;
begin
    if Fschedule = nil then
        raise Exception.Create('No schedule loaded.');

    writeStdoutLine(Fschedule.scheduleToJson);
end;

{*******************************************************************************
* emitLoadedEvent
*******************************************************************************}
procedure TGnauralApp.emitLoadedEvent;
begin
    if Fschedule = nil then
        Exit;

    writeStdoutLine('{"event":"loaded"' +
        ',"file":"' + jsonEscape(FloadedFileName) + '"' +
        ',"title":"' + jsonEscape(Fschedule.Title) + '"' +
        ',"duration":' + jsonLogFloat3(Fschedule.TotalTime) +
        ',"loops":' + IntToStr(Fschedule.LoopCount) +
        ',"voices":' + IntToStr(Fschedule.VoiceCount) +
        ',"schedule":' + Fschedule.scheduleToJson +
        '}');
end;

    {*******************************************************************************
    * emitPlaybackProgressEvent
    *******************************************************************************}
    procedure TGnauralApp.emitPlaybackProgressEvent(aPositionSec: Double; aLoop: Integer);
    begin
        writeStdoutLine('{"event":"playback_progress"' +
        ',"pos":' + jsonLogFloat3(aPositionSec) +
        ',"loop":' + IntToStr(aLoop) +
        '}');
    end;

{*******************************************************************************
* emitPlaybackCompletedEvent
*******************************************************************************}
procedure TGnauralApp.emitPlaybackCompletedEvent;
begin
    writeStdoutLine('{"event":"playback_completed"}');
end;

{*******************************************************************************
* printUsage
*******************************************************************************}
procedure TGnauralApp.printUsage;
begin
    WriteLn('Usage: gnaural.exe <file.gnaural> [options]');
    WriteLn;
    WriteLn('  Plays a binaural beat composition from a .gnaural XML file.');
    WriteLn('  Requires portaudio.dll in the same directory unless using offline output.');
    WriteLn;
    WriteLn('Options:');
    WriteLn('  -o <file.wav|file.flac>  Render to WAV or FLAC (offline, no audio device needed)');
    WriteLn('  --convert-audio <input> <output>  Convert a source audio file to WAV or FLAC');
    WriteLn('  --dump-schedule <file.gnaural>  Dump calibrated schedule JSON to stdout');
    WriteLn('  --server       Start persistent Bun-controlled server mode');
    WriteLn;
    WriteLn('Examples:');
    WriteLn('  gnaural.exe alert.gnaural');
    WriteLn('  gnaural.exe alert.gnaural -o output.wav');
    WriteLn('  gnaural.exe alert.gnaural -o output.flac');
    WriteLn('  gnaural.exe --convert-audio voice.flac voice.wav');
    WriteLn('  gnaural.exe --dump-schedule alert.gnaural');
    WriteLn('  gnaural.exe --server');
end;

{*******************************************************************************
* printInfo
*******************************************************************************}
procedure TGnauralApp.printInfo;
var
    i: Integer;
    voice: TVoice;
    typeNames: array[TVoiceType] of string;
    mins, secs: Integer;
begin
    typeNames[vtBinaural]    := 'Binaural';
    typeNames[vtPinkNoise]   := 'PinkNoise';
    typeNames[vtPCM]         := 'PCM';
    typeNames[vtIsoPulse]    := 'IsoPulse';
    typeNames[vtIsoPulseAlt] := 'IsoPulseAlt';
    typeNames[vtWaterdrops]  := 'Waterdrops';
    typeNames[vtRain]        := 'Rain';

    mins := Trunc(Fschedule.TotalTime) div 60;
    secs := Trunc(Fschedule.TotalTime) mod 60;

    WriteLn('Title:    ', Fschedule.Title);
    WriteLn('Author:   ', Fschedule.Author);
    WriteLn('Duration: ', mins, 'm ', secs, 's  (', Fschedule.LoopCount, ' loop(s))');
    WriteLn('Voices:   ', Fschedule.VoiceCount);

    for i := 0 to Fschedule.VoiceCount - 1 do
    begin
        voice := Fschedule.getVoice(i);
        Write('  [', i, '] ', typeNames[voice.VoiceType]);
        Write('  entries=', voice.EntryCount);
        if voice.Mute then Write('  MUTED');
        if voice.Mono then Write('  mono');
        if voice.Description <> '' then Write('  "', voice.Description, '"');
        WriteLn;
        if (voice.VoiceType = vtPCM) and (voice.AudioFilePath = '') then
            WriteLn(ErrOutput, '  WARNING: PCM voice has no audio file; will be silent');
    end;
    WriteLn;
end;

{*******************************************************************************
* startAudioOutput
*******************************************************************************}
procedure TGnauralApp.startAudioOutput;
begin
    FreeAndNil(FaudioOutput);
    FaudioOutput := TAudioOutput.Create(Fsynth);
    try
        FaudioOutput.start;
    except
        FreeAndNil(FaudioOutput);
        raise;
    end;
end;

{*******************************************************************************
* runServer
*******************************************************************************}
procedure TGnauralApp.runServer;
var
    cmd: TGnauralCommand;
    line: string;
    eofReached: Boolean;
    positionSec: Double;
begin
    writeStdoutLine('{"event":"server_ready"}');

    while True do
    begin
        if (FaudioOutput <> nil) and (Fsynth <> nil) and Fsynth.isCompleted then
        begin
            stopPlayback(True);
            emitPlaybackCompletedEvent;
        end;

        if (FaudioOutput <> nil) and (Fsynth <> nil) and (not Fsynth.isPaused) then
        begin
            positionSec := Fsynth.getPlaybackPosition;
            // TP3.1: emit on the first tick, on a loop wrap (position dropped back near 0), or once
            // the position has advanced by the adaptive interval — not only on whole-second changes.
            if (FlastProgressPos < 0) or (positionSec < FlastProgressPos)
               or (positionSec - FlastProgressPos >= FprogressIntervalSec) then
            begin
                FlastProgressPos := positionSec;
                emitPlaybackProgressEvent(positionSec, Fsynth.getCurrentLoop);
            end;
        end;

        if not tryReadStdinLineWithTimeout(line, 100, eofReached) then
        begin
            if eofReached then
            begin
                stopPlayback(False);
                Break;
            end;
            Continue;
        end;

        line := Trim(line);
        if line = '' then
            Continue;

        if not parseGnauralCommand(line, cmd) or
            (cmd.CmdType = gctUnknown) then
        begin
            writeStdoutLine(makeGnauralAck('unknown', False,
                'Unknown or malformed command'));
            Continue;
        end;

        try
            case cmd.CmdType of
                gctLoad:
                begin
                    loadScheduleFile(cmd.FileName);
                    emitLoadedEvent;
                    emitCommandAck(gctLoad, True);
                end;

                gctStart:
                begin
                    if Fschedule = nil then
                        raise Exception.Create('No schedule loaded.');
                    if FaudioOutput <> nil then
                        raise Exception.Create('Already running.');

                    if Fsynth = nil then
                        rebuildSynth;

                    Fsynth.resume;
                    FlastProgressPos := -1;
                    startAudioOutput;
                    emitCommandAck(gctStart, True);
                end;

                gctPause:
                begin
                    if (Fsynth = nil) or (FaudioOutput = nil) then
                        raise Exception.Create('Playback is not running.');

                    Fsynth.pause;
                    emitCommandAck(gctPause, True);
                end;

                gctResume:
                begin
                    if (Fsynth = nil) or (FaudioOutput = nil) then
                        raise Exception.Create('Playback is not running.');

                    Fsynth.resume;
                    emitCommandAck(gctResume, True);
                end;

                gctSeek:
                begin
                    if Fsynth = nil then
                        raise Exception.Create('No schedule loaded.');

                    Fsynth.seek(cmd.PositionSec);
                    FlastProgressPos := cmd.PositionSec;
                    emitPlaybackProgressEvent(cmd.PositionSec, Fsynth.getCurrentLoop);
                    emitCommandAck(gctSeek, True);
                end;

                gctSetVolume:
                begin
                    if Fsynth = nil then
                        raise Exception.Create('No schedule loaded.');

                    Fsynth.setMasterVolume(cmd.LeftVolume,
                        cmd.RightVolume);
                    emitCommandAck(gctSetVolume, True);
                end;

                gctMuteVoice:
                begin
                    if Fschedule = nil then
                        raise Exception.Create('No schedule loaded.');

                    if (cmd.VoiceId < 0) or (cmd.VoiceId >= Fschedule.VoiceCount) then
                        raise Exception.CreateFmt('Voice index out of range: %d', [cmd.VoiceId]);

                    if Fsynth = nil then
                        rebuildSynth;

                    Fschedule.getVoice(cmd.VoiceId).Mute := cmd.Muted;
                    Fsynth.muteVoice(cmd.VoiceId, cmd.Muted);
                    emitCommandAck(gctMuteVoice, True);
                end;

                gctStop:
                begin
                    stopPlayback(True);
                    emitCommandAck(gctStop, True);
                end;

                gctEntry:
                begin
                    if Fschedule = nil then
                        raise Exception.Create('No schedule loaded.');
                    if (cmd.VoiceId < 0) or (cmd.VoiceId >= Fschedule.VoiceCount) then
                        raise Exception.CreateFmt('Voice index out of range: %d', [cmd.VoiceId]);
                    if not Fschedule.getVoice(cmd.VoiceId).IsExternalStdin then
                        raise Exception.CreateFmt(
                            'Voice %d is not an external stdin voice', [cmd.VoiceId]);
                    if Fsynth = nil then
                        raise Exception.Create('No synth active.');

                    Fsynth.pushExternalEntry(
                        cmd.VoiceId,
                        cmd.BaseFreq,
                        cmd.BeatFreq,
                        cmd.VolL,
                        cmd.VolR,
                        cmd.TransitionTimeSec,
                        cmd.DurationSec);
                    emitCommandAck(gctEntry, True);
                end;

                gctQuit:
                begin
                    stopPlayback(False);
                    emitCommandAck(gctQuit, True);
                    Break;
                end;
            else
                emitCommandAck(gctUnknown, False, 'Unknown command');
            end;
        except
            on E: Exception do
                emitCommandAck(cmd.CmdType, False, E.Message);
        end;
    end;
end;

function TGnauralApp.run: Integer;
var
    i: Integer;
    arg: string;
    fileName: string;
    convertMode: Boolean;
    serverMode: Boolean;
    dumpScheduleMode: Boolean;
    convertSourceFileName: string;
    convertTargetFileName: string;
begin
    Result := 0;
    fileName := '';
    convertMode := False;
    serverMode := False;
    FoutputFileName := '';
    dumpScheduleMode := False;
    convertSourceFileName := '';
    convertTargetFileName := '';

    // Parse arguments
    i := 1;
    while i <= ParamCount do
    begin
        arg := ParamStr(i);
        if (arg = '--help') or (arg = '-h') or (arg = '/?') then
        begin
            printUsage;
            Exit;
        end
        else if arg = '-o' then
        begin
            if i >= ParamCount then
            begin
                WriteLn(ErrOutput, 'ERROR: -o requires a filename');
                Result := 1;
                Exit;
            end;
            Inc(i);
            FoutputFileName := ParamStr(i);
        end
        else if arg = '--convert-audio' then
        begin
            if i + 2 > ParamCount then
            begin
                WriteLn(ErrOutput, 'ERROR: --convert-audio requires input and output filenames');
                Result := 1;
                Exit;
            end;
            convertMode := True;
            Inc(i);
            convertSourceFileName := ParamStr(i);
            Inc(i);
            convertTargetFileName := ParamStr(i);
        end
        else if arg = '--dump-schedule' then
            dumpScheduleMode := True
        else if arg = '--server' then
            serverMode := True
        else if arg = '--log' then
        begin
            WriteLn(ErrOutput, 'ERROR: --log is no longer supported.');
            Result := 1;
            Exit;
        end
        else if arg = '--log-format' then
        begin
            WriteLn(ErrOutput, 'ERROR: --log-format is no longer supported.');
            Result := 1;
            Exit;
        end
        else if Pos('--log-format=', LowerCase(arg)) = 1 then
        begin
            WriteLn(ErrOutput, 'ERROR: --log-format is no longer supported.');
            Result := 1;
            Exit;
        end
        else if fileName = '' then
            fileName := arg
        else
        begin
            WriteLn(ErrOutput, 'ERROR: Unexpected argument: ', arg);
            Result := 1;
            Exit;
        end;
        Inc(i);
    end;

    if dumpScheduleMode then
    begin
        if serverMode then
        begin
            WriteLn(ErrOutput, 'ERROR: --dump-schedule is not supported with --server.');
            Result := 1;
            Exit;
        end;

        if FoutputFileName <> '' then
        begin
            WriteLn(ErrOutput, 'ERROR: --dump-schedule is not supported with -o.');
            Result := 1;
            Exit;
        end;

        if fileName = '' then
        begin
            WriteLn(ErrOutput, 'ERROR: --dump-schedule requires a .gnaural file.');
            Result := 1;
            Exit;
        end;

        try
            loadScheduleFile(fileName);
            dumpSchedule;
        except
            on E: Exception do
            begin
                WriteLn(ErrOutput, 'ERROR: ', E.Message);
                Result := 1;
            end;
        end;
        Exit;
    end;

    if convertMode then
    begin
        if serverMode then
        begin
            WriteLn(ErrOutput, 'ERROR: --convert-audio is not supported with --server.');
            Result := 1;
            Exit;
        end;

        if dumpScheduleMode then
        begin
            WriteLn(ErrOutput, 'ERROR: --convert-audio is not supported with --dump-schedule.');
            Result := 1;
            Exit;
        end;

        if FoutputFileName <> '' then
        begin
            WriteLn(ErrOutput, 'ERROR: --convert-audio is not supported with -o.');
            Result := 1;
            Exit;
        end;

        if fileName <> '' then
        begin
            WriteLn(ErrOutput, 'ERROR: Unexpected .gnaural file when using --convert-audio.');
            Result := 1;
            Exit;
        end;

        try
            WriteLn('Converting audio: ', convertSourceFileName);
            convertAudioFile(convertSourceFileName, convertTargetFileName);
            WriteLn('Done. ', convertTargetFileName);
        except
            on E: Exception do
            begin
                WriteLn(ErrOutput, 'ERROR: ', E.Message);
                Result := 1;
            end;
        end;
        Exit;
    end;

    if serverMode then
    begin
        if FoutputFileName <> '' then
        begin
            WriteLn(ErrOutput, 'ERROR: -o is not supported with --server.');
            Result := 1;
            Exit;
        end;

        if fileName <> '' then
            loadScheduleFile(fileName);

        runServer;
        Exit;
    end;

    if fileName = '' then
    begin
        printUsage;
        Result := 1;
        Exit;
    end;

    WriteLn('Loading: ', fileName);
    loadScheduleFile(fileName);

    printInfo;

    if FoutputFileName <> '' then
    begin
        WriteLn('Rendering to audio file: ', FoutputFileName);
        try
            renderSynthToAudioFile(Fsynth, FoutputFileName);
        except
            on E: Exception do
            begin
                WriteLn(ErrOutput, 'ERROR: ', E.Message);
                Result := 1;
                Exit;
            end;
        end;
        WriteLn('Done. ', FoutputFileName);
    end
    else
    begin
        // Real-time playback via PortAudio
        startAudioOutput;

        WriteLn('Playing... Press Ctrl+C to stop.');
        WriteLn;

        while not Fsynth.isCompleted do
            Sleep(50);

        FaudioOutput.stop;

        WriteLn;
        WriteLn('Done.');
    end;
end;

end.
