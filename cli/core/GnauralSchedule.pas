unit GnauralSchedule;

{$mode objfpc}{$H+}

interface

uses
    SysUtils, Classes, DOM, XMLRead;

const
    GNAURAL_SAMPLE_RATE    = 44100.0;

type
    TVoiceType = (
        vtBinaural    = 0,
        vtPinkNoise   = 1,
        vtPCM         = 2,
        vtIsoPulse    = 3,
        vtIsoPulseAlt = 4,
        vtWaterdrops  = 5,
        vtRain        = 6
    );

    TScheduleEntry = record
        duration              : Double;
        absoluteStart         : Cardinal;
        absoluteEnd           : Cardinal;
        volLstart             : Double;
        volLend               : Double;
        volLspread            : Double;
        volRstart             : Double;
        volRend               : Double;
        volRspread            : Double;
        basefreqStart         : Double;
        basefreqEnd           : Double;
        basefreqSpread        : Double;
        beatfreqHalfStart     : Double;
        beatfreqHalfEnd       : Double;
        beatfreqHalfSpread    : Double;
    end;

    TStringArray = array of string;

    {***************************************************************************
     * TVoice
     ***************************************************************************}
    TVoice = class
private
    Fid                     : Integer;
    FvoiceType              : TVoiceType;
    Fhidden                 : Boolean;
    Fmute                   : Boolean;
    Fmono                   : Boolean;
    Fcolor                  : string;
    Fdescription            : string;
    FaudioFilePath          : string;
    FtotalDuration          : Double;
    FentryCount             : Integer;
    Fentries                : array of TScheduleEntry;
    FisExternalStdin        : Boolean;
    FextInitBase            : Double;
    FextInitBeat            : Double;
    FextInitVolL            : Double;
    FextInitVolR            : Double;

public
    constructor Create;
    destructor  Destroy; override;

    procedure   addEntry(const aEntry: TScheduleEntry);
    function    getEntry(aIndex: Integer): TScheduleEntry;

    property Id             : Integer   read Fid              write Fid;
    property VoiceType      : TVoiceType read FvoiceType      write FvoiceType;
    property Hidden         : Boolean   read Fhidden          write Fhidden;
    property Mute           : Boolean   read Fmute            write Fmute;
    property Mono           : Boolean   read Fmono            write Fmono;
    property Color          : string    read Fcolor           write Fcolor;
    property Description    : string    read Fdescription     write Fdescription;
    property AudioFilePath  : string    read FaudioFilePath   write FaudioFilePath;
    property TotalDuration  : Double    read FtotalDuration;
    property EntryCount     : Integer   read FentryCount;
    property IsExternalStdin: Boolean   read FisExternalStdin write FisExternalStdin;
    property ExtInitBase    : Double    read FextInitBase     write FextInitBase;
    property ExtInitBeat    : Double    read FextInitBeat     write FextInitBeat;
    property ExtInitVolL    : Double    read FextInitVolL     write FextInitVolL;
    property ExtInitVolR    : Double    read FextInitVolR     write FextInitVolR;
    end;

    {***************************************************************************
     * TGnauralSchedule
     ***************************************************************************}
    TGnauralSchedule = class
private
    Ftitle                  : string;
    Fauthor                 : string;
    Fdescription            : string;
    FbaseDir                : string;
    FtotalTime              : Double;
    FloopCount              : Integer;
    FoverallVolLeft         : Double;
    FoverallVolRight        : Double;
    FstereoSwap             : Boolean;
    FvoiceCount             : Integer;
    Fvoices                 : array of TVoice;

private
    function    getChildText(aParent: TDOMNode; const aName: string): string;
    function    parseFloat(const aStr: string): Double;
    procedure   appendArgument(var aArguments: TStringArray; const aValue: string);
    procedure   parseAndAddEntryNode(aVoice: TVoice; aEntryNode: TDOMElement);
    function    resolvePreparseGeneratorPath(const aGeneratorPath: string): string;
    function    runExternalCommand(
                    const aExecutable: string;
                    const aArguments: TStringArray;
                    out aStdoutText: string;
                    out aStderrText: string): Integer;
    procedure   runPreparseEntryGenerator(
                    aVoice: TVoice;
                    aEntryNode: TDOMElement;
                    aLineNo: Integer;
                    const aSourceFilePath: string);
    procedure   calibrateVoice(aVoice: TVoice);
    procedure   parseVoiceNode(aVoiceNode: TDOMNode; const aSourceFilePath: string);

public
    constructor Create;
    destructor  Destroy; override;

    procedure   loadFromFile(const aFileName: string);
    function    getVoice(aIndex: Integer): TVoice;
    function    scheduleToJson: string;

    property Title          : string  read Ftitle;
    property Author         : string  read Fauthor;
    property Description    : string  read Fdescription;
    property TotalTime      : Double  read FtotalTime;
    property LoopCount      : Integer read FloopCount;
    property OverallVolLeft : Double  read FoverallVolLeft;
    property OverallVolRight: Double  read FoverallVolRight;
    property StereoSwap     : Boolean read FstereoSwap;
    property VoiceCount     : Integer read FvoiceCount;
    property BaseDir        : string  read FbaseDir;
    end;

implementation

uses
    Windows,
    JsonLogWriter,
    LogCore;

var
    gDotFmt: TFormatSettings;

{*******************************************************************************
* jsonBool
*******************************************************************************}
function jsonBool(aValue: Boolean): string;
begin
    if aValue then
        Result := 'true'
    else
        Result := 'false';
end;

{*******************************************************************************
* voiceTypeToJsonName
*******************************************************************************}
function voiceTypeToJsonName(aVoiceType: TVoiceType): string;
begin
    case aVoiceType of
        vtBinaural:
            Result := 'binaural';
        vtPinkNoise:
            Result := 'pink_noise';
        vtPCM:
            Result := 'pcm';
        vtIsoPulse:
            Result := 'iso_pulse';
        vtIsoPulseAlt:
            Result := 'iso_pulse_alt';
        vtWaterdrops:
            Result := 'waterdrops';
        vtRain:
            Result := 'rain';
    else
        Result := 'unknown';
    end;
end;

{ TVoice }

constructor TVoice.Create;
begin
    inherited Create;
    Fid := 0;
    FvoiceType := vtBinaural;
    Fhidden := False;
    Fmute := False;
    Fmono := False;
    Fcolor := '';
    Fdescription := '';
    FaudioFilePath := '';
    FtotalDuration := 0;
    FentryCount := 0;
    SetLength(Fentries, 0);
    FisExternalStdin := False;
    FextInitBase := 0;
    FextInitBeat := 0;
    FextInitVolL := 0;
    FextInitVolR := 0;
end;

destructor TVoice.Destroy;
begin
    SetLength(Fentries, 0);
    inherited Destroy;
end;

procedure TVoice.addEntry(const aEntry: TScheduleEntry);
begin
    SetLength(Fentries, FentryCount + 1);
    Fentries[FentryCount] := aEntry;
    Inc(FentryCount);
end;

{*******************************************************************************
* getEntry
*******************************************************************************}
function TVoice.getEntry(aIndex: Integer): TScheduleEntry;
begin
    if (aIndex < 0) or (aIndex >= FentryCount) then
        raise Exception.CreateFmt('Voice entry index out of range: %d', [aIndex]);

    Result := Fentries[aIndex];
end;

{ TGnauralSchedule }

constructor TGnauralSchedule.Create;
begin
    inherited Create;
    Ftitle := '';
    Fauthor := '';
    Fdescription := '';
    FtotalTime := 0;
    FloopCount := 1;
    FoverallVolLeft := 1.0;
    FoverallVolRight := 1.0;
    FstereoSwap := False;
    FvoiceCount := 0;
    SetLength(Fvoices, 0);
end;

destructor TGnauralSchedule.Destroy;
var
    i: Integer;
begin
    for i := 0 to FvoiceCount - 1 do
        FreeAndNil(Fvoices[i]);
    SetLength(Fvoices, 0);
    inherited Destroy;
end;

function TGnauralSchedule.getChildText(aParent: TDOMNode; const aName: string): string;
var
    node: TDOMNode;
begin
    Result := '';
    node := aParent.FirstChild;
    while node <> nil do
    begin
        if (node.NodeType = ELEMENT_NODE) and (string(node.NodeName) = aName) then
        begin
            Result := UTF8Encode(node.TextContent);
            Exit;
        end;
        node := node.NextSibling;
    end;
end;

function TGnauralSchedule.parseFloat(const aStr: string): Double;
begin
    if not TryStrToFloat(Trim(aStr), Result, gDotFmt) then
        Result := 0.0;
end;

{*******************************************************************************
* appendArgument
*******************************************************************************}
procedure TGnauralSchedule.appendArgument(var aArguments: TStringArray; const aValue: string);
var
    argCount: Integer;
begin
    argCount := Length(aArguments);
    SetLength(aArguments, argCount + 1);
    aArguments[argCount] := aValue;
end;

{*******************************************************************************
* parseAndAddEntryNode
*******************************************************************************}
procedure TGnauralSchedule.parseAndAddEntryNode(aVoice: TVoice; aEntryNode: TDOMElement);
var
    entry: TScheduleEntry;
begin
    FillChar(entry, SizeOf(entry), 0);
    entry.duration          := parseFloat(string(aEntryNode.GetAttribute('duration')));
    entry.volLstart         := parseFloat(string(aEntryNode.GetAttribute('volume_left')));
    entry.volRstart         := parseFloat(string(aEntryNode.GetAttribute('volume_right')));
    entry.beatfreqHalfStart := parseFloat(string(aEntryNode.GetAttribute('beatfreq'))) / 2;
    entry.basefreqStart     := parseFloat(string(aEntryNode.GetAttribute('basefreq')));
    aVoice.addEntry(entry);
end;

{*******************************************************************************
* resolvePreparseGeneratorPath
*******************************************************************************}
function TGnauralSchedule.resolvePreparseGeneratorPath(const aGeneratorPath: string): string;
var
    normalizedPath: string;
begin
    normalizedPath := Trim(aGeneratorPath);
    if normalizedPath = '' then
        raise Exception.Create('Preparse entry requires a non-empty generator path.');

    if ExtractFileDrive(normalizedPath) <> '' then
    begin
        Result := ExpandFileName(normalizedPath);
        Exit;
    end;

    Result := ExpandFileName(FbaseDir + normalizedPath);
    if CompareText(Copy(Result, 1, Length(FbaseDir)), FbaseDir) <> 0 then
        raise Exception.CreateFmt('Preparse generator path is outside schedule directory: %s', [normalizedPath]);
end;

{*******************************************************************************
* runExternalCommand
*******************************************************************************}
function TGnauralSchedule.runExternalCommand(
    const aExecutable: string;
    const aArguments: TStringArray;
    out aStdoutText: string;
    out aStderrText: string): Integer;
const
    GENERATOR_TIMEOUT_MS: DWORD = 30000;
var
    secAttrs: TSecurityAttributes;
    startupInfo: TStartupInfo;
    processInfo: TProcessInformation;
    stdoutReadHandle: THandle;
    stdoutWriteHandle: THandle;
    stderrReadHandle: THandle;
    stderrWriteHandle: THandle;
    nullInputHandle: THandle;
    stdoutStream: TStringStream;
    stderrStream: TStringStream;
    commandLineText: string;
    commandWaitResult: DWORD;
    processExitCode: DWORD;
    startTick: DWORD;
    argIndex: Integer;
    bytesAvailable: DWORD;
    bytesRead: DWORD;
    readBuffer: array[0..4095] of AnsiChar;
    readSize: DWORD;

    function quoteWindowsArgument(const aValue: string): string;
    var
        i: Integer;
        slashCount: Integer;
        ch: Char;
    begin
        if (aValue = '') or (Pos(' ', aValue) > 0) or (Pos(#9, aValue) > 0) or (Pos('"', aValue) > 0) then
        begin
            Result := '"';
            slashCount := 0;
            for i := 1 to Length(aValue) do
            begin
                ch := aValue[i];
                if ch = '\' then
                begin
                    Inc(slashCount);
                    Continue;
                end;

                if ch = '"' then
                begin
                    Result := Result + StringOfChar('\', slashCount * 2 + 1) + '"';
                    slashCount := 0;
                    Continue;
                end;

                if slashCount > 0 then
                begin
                    Result := Result + StringOfChar('\', slashCount);
                    slashCount := 0;
                end;

                Result := Result + ch;
            end;

            if slashCount > 0 then
                Result := Result + StringOfChar('\', slashCount * 2);

            Result := Result + '"';
            Exit;
        end;

        Result := aValue;
    end;

    procedure drainPipe(aPipeHandle: THandle; var aTarget: TStringStream);
    begin
        while PeekNamedPipe(aPipeHandle, nil, 0, nil, @bytesAvailable, nil) and (bytesAvailable > 0) do
        begin
            if bytesAvailable > SizeOf(readBuffer) then
                readSize := SizeOf(readBuffer)
            else
                readSize := bytesAvailable;

            if not ReadFile(aPipeHandle, readBuffer[0], readSize, bytesRead, nil) then
                Break;
            if bytesRead = 0 then
                Break;

            aTarget.Write(readBuffer[0], bytesRead);
        end;
    end;
begin
    aStdoutText := '';
    aStderrText := '';

    stdoutReadHandle := 0;
    stdoutWriteHandle := 0;
    stderrReadHandle := 0;
    stderrWriteHandle := 0;
    nullInputHandle := INVALID_HANDLE_VALUE;
    stdoutStream := nil;
    stderrStream := nil;
    FillChar(processInfo, SizeOf(processInfo), 0);

    FillChar(secAttrs, SizeOf(secAttrs), 0);
    secAttrs.nLength := SizeOf(secAttrs);
    secAttrs.bInheritHandle := True;

    try
        if not CreatePipe(stdoutReadHandle, stdoutWriteHandle, @secAttrs, 0) then
            raise Exception.Create('Failed to create stdout pipe for preparse generator.');

        if not SetHandleInformation(stdoutReadHandle, HANDLE_FLAG_INHERIT, 0) then
            raise Exception.Create('Failed to configure stdout pipe handle inheritance.');

        if not CreatePipe(stderrReadHandle, stderrWriteHandle, @secAttrs, 0) then
            raise Exception.Create('Failed to create stderr pipe for preparse generator.');

        if not SetHandleInformation(stderrReadHandle, HANDLE_FLAG_INHERIT, 0) then
            raise Exception.Create('Failed to configure stderr pipe handle inheritance.');

        nullInputHandle := CreateFile('nul', GENERIC_READ,
            FILE_SHARE_READ or FILE_SHARE_WRITE, @secAttrs, OPEN_EXISTING, 0, 0);
        if nullInputHandle = INVALID_HANDLE_VALUE then
            raise Exception.Create('Failed to open NUL device for preparse generator stdin.');

        stdoutStream := TStringStream.Create('');
        stderrStream := TStringStream.Create('');
        commandLineText := quoteWindowsArgument(aExecutable);
        for argIndex := Low(aArguments) to High(aArguments) do
            commandLineText := commandLineText + ' ' + quoteWindowsArgument(aArguments[argIndex]);

        FillChar(startupInfo, SizeOf(startupInfo), 0);
        startupInfo.cb := SizeOf(startupInfo);
        startupInfo.dwFlags := STARTF_USESHOWWINDOW or STARTF_USESTDHANDLES;
        startupInfo.wShowWindow := SW_HIDE;
        startupInfo.hStdInput := nullInputHandle;
        startupInfo.hStdOutput := stdoutWriteHandle;
        startupInfo.hStdError := stderrWriteHandle;

        UniqueString(commandLineText);
        if not CreateProcess(
            nil,
            PChar(commandLineText),
            nil,
            nil,
            True,
            CREATE_NO_WINDOW,
            nil,
            nil,
            startupInfo,
            processInfo
        ) then
            raise Exception.CreateFmt(
                'Failed to start preparse generator process: %s (error code %d)',
                [aExecutable, GetLastError]);

        CloseHandle(nullInputHandle);
        nullInputHandle := INVALID_HANDLE_VALUE;

        if stdoutWriteHandle <> 0 then
        begin
            CloseHandle(stdoutWriteHandle);
            stdoutWriteHandle := 0;
        end;
        if stderrWriteHandle <> 0 then
        begin
            CloseHandle(stderrWriteHandle);
            stderrWriteHandle := 0;
        end;

        startTick := GetTickCount;
        while True do
        begin
            drainPipe(stdoutReadHandle, stdoutStream);
            drainPipe(stderrReadHandle, stderrStream);

            commandWaitResult := WaitForSingleObject(processInfo.hProcess, 10);
            if commandWaitResult = WAIT_OBJECT_0 then
                Break;
            if commandWaitResult = WAIT_FAILED then
                raise Exception.CreateFmt(
                    'WaitForSingleObject failed for preparse generator (error %d)',
                    [GetLastError]);
            if GetTickCount - startTick > GENERATOR_TIMEOUT_MS then
            begin
                TerminateProcess(processInfo.hProcess, 1);
                raise Exception.CreateFmt(
                    'Preparse generator timed out after %d seconds: %s',
                    [GENERATOR_TIMEOUT_MS div 1000, aExecutable]);
            end;
        end;

        drainPipe(stdoutReadHandle, stdoutStream);
        drainPipe(stderrReadHandle, stderrStream);

        processExitCode := DWORD(-1);
        if not GetExitCodeProcess(processInfo.hProcess, processExitCode) then
            raise Exception.Create('Failed to read preparse generator exit code.');

        aStdoutText := stdoutStream.DataString;
        aStderrText := stderrStream.DataString;
        Result := Integer(processExitCode);
    finally
        FreeAndNil(stdoutStream);
        FreeAndNil(stderrStream);
        if processInfo.hThread <> 0 then
            CloseHandle(processInfo.hThread);
        if processInfo.hProcess <> 0 then
            CloseHandle(processInfo.hProcess);
        if stdoutReadHandle <> 0 then
            CloseHandle(stdoutReadHandle);
        if stdoutWriteHandle <> 0 then
            CloseHandle(stdoutWriteHandle);
        if stderrReadHandle <> 0 then
            CloseHandle(stderrReadHandle);
        if stderrWriteHandle <> 0 then
            CloseHandle(stderrWriteHandle);
        if nullInputHandle <> INVALID_HANDLE_VALUE then
            CloseHandle(nullInputHandle);
    end;
end;

{*******************************************************************************
* runPreparseEntryGenerator
*******************************************************************************}
procedure TGnauralSchedule.runPreparseEntryGenerator(
    aVoice: TVoice;
    aEntryNode: TDOMElement;
    aLineNo: Integer;
    const aSourceFilePath: string);
var
    generatorPath: string;
    generatorArgs: TStringArray;
    attrIndex: Integer;
    attrNode: TDOMNode;
    attrName: string;
    attrValue: string;
    stdoutText: string;
    stderrText: string;
    exitCode: Integer;
    wrappedXml: string;
    generatedStream: TStringStream;
    generatedDoc: TXMLDocument;
    generatedNode: TDOMNode;
begin
    generatorPath := resolvePreparseGeneratorPath(string(aEntryNode.GetAttribute('generator')));
    if not FileExists(generatorPath) then
        raise Exception.CreateFmt('Preparse generator not found: %s', [generatorPath]);

    SetLength(generatorArgs, 0);
    appendArgument(generatorArgs, '--gnaural_file');
    appendArgument(generatorArgs, ExpandFileName(aSourceFilePath));
    appendArgument(generatorArgs, '--line_no');
    appendArgument(generatorArgs, IntToStr(aLineNo));

    for attrIndex := 0 to aEntryNode.Attributes.Length - 1 do
    begin
        attrNode := aEntryNode.Attributes.Item[attrIndex];
        if attrNode = nil then
            Continue;

        attrName := string(attrNode.NodeName);
        if (CompareText(attrName, 'type') = 0) or
            (CompareText(attrName, 'generator') = 0) then
            Continue;

        attrValue := string(attrNode.NodeValue);
        appendArgument(generatorArgs, '--' + attrName);
        appendArgument(generatorArgs, attrValue);
    end;

    exitCode := runExternalCommand(generatorPath, generatorArgs, stdoutText, stderrText);
    if exitCode <> 0 then
    begin
        stderrText := Trim(stderrText);
        if stderrText = '' then
            stderrText := Trim(stdoutText);
        if stderrText = '' then
            stderrText := Format('Preparse generator failed with exit code %d', [exitCode]);

        raise Exception.CreateFmt('Preparse generator error (%s): %s', [generatorPath, stderrText]);
    end;

    stdoutText := Trim(stdoutText);
    if stdoutText = '' then
        Exit;

    wrappedXml := '<preparse_entries>' + stdoutText + '</preparse_entries>';
    generatedStream := TStringStream.Create(wrappedXml);
    generatedDoc := nil;
    try
        try
            ReadXMLFile(generatedDoc, generatedStream);
        except
            on E: Exception do
                raise Exception.Create('Preparse generator returned invalid XML: ' + E.Message);
        end;

        generatedNode := generatedDoc.DocumentElement.FirstChild;
        while generatedNode <> nil do
        begin
            if generatedNode.NodeType = ELEMENT_NODE then
            begin
                if string(generatedNode.NodeName) <> 'entry' then
                    raise Exception.CreateFmt(
                        'Preparse generator returned unsupported element <%s>',
                        [string(generatedNode.NodeName)]);

                parseAndAddEntryNode(aVoice, TDOMElement(generatedNode));
            end;

            generatedNode := generatedNode.NextSibling;
        end;
    finally
        FreeAndNil(generatedDoc);
        FreeAndNil(generatedStream);
    end;
end;

procedure TGnauralSchedule.calibrateVoice(aVoice: TVoice);
var
    e, j, n: Integer;
    totalDur: Double;
begin
    n := aVoice.EntryCount;
    if n = 0 then
        Exit;

    totalDur := 0;
    for j := 0 to n - 1 do
    begin
        totalDur := totalDur + aVoice.Fentries[j].duration;
        aVoice.Fentries[j].absoluteEnd := Round(totalDur * GNAURAL_SAMPLE_RATE);
    end;
    aVoice.FtotalDuration := totalDur;

    for j := 0 to n - 1 do
    begin
        // Gnaural interpolates each entry toward the next one, wrapping the
        // last entry back to the first to keep the schedule cyclic.
        if j + 1 >= n then
            e := 0
        else
            e := j + 1;

        aVoice.Fentries[j].beatfreqHalfEnd    := aVoice.Fentries[e].beatfreqHalfStart;
        aVoice.Fentries[j].beatfreqHalfSpread := aVoice.Fentries[j].beatfreqHalfEnd - aVoice.Fentries[j].beatfreqHalfStart;

        aVoice.Fentries[j].basefreqEnd        := aVoice.Fentries[e].basefreqStart;
        aVoice.Fentries[j].basefreqSpread     := aVoice.Fentries[j].basefreqEnd - aVoice.Fentries[j].basefreqStart;

        aVoice.Fentries[j].volLend            := aVoice.Fentries[e].volLstart;
        aVoice.Fentries[j].volLspread         := aVoice.Fentries[j].volLend - aVoice.Fentries[j].volLstart;

        aVoice.Fentries[j].volRend            := aVoice.Fentries[e].volRstart;
        aVoice.Fentries[j].volRspread         := aVoice.Fentries[j].volRend - aVoice.Fentries[j].volRstart;

        if j = 0 then
            aVoice.Fentries[j].absoluteStart := 0
        else
            aVoice.Fentries[j].absoluteStart := aVoice.Fentries[j - 1].absoluteEnd;
    end;

    if FtotalTime < totalDur then
        FtotalTime := totalDur;
end;

procedure TGnauralSchedule.parseVoiceNode(aVoiceNode: TDOMNode; const aSourceFilePath: string);
var
    e, en: TDOMNode;
    voice: TVoice;
    typeInt: Integer;
    resolvedAudioPath: string;
    entryLineNo: Integer;
    entryType: string;
begin
    voice := TVoice.Create;
    voice.Description := getChildText(aVoiceNode, 'description');
    voice.Id := StrToIntDef(getChildText(aVoiceNode, 'id'), 0);

    typeInt := StrToIntDef(getChildText(aVoiceNode, 'type'), 0);
    if (typeInt >= Ord(vtBinaural)) and (typeInt <= Ord(vtRain)) then
        voice.VoiceType := TVoiceType(typeInt)
    else
        voice.VoiceType := vtBinaural;

    voice.Hidden := getChildText(aVoiceNode, 'mindwave_hidden') = '1';
    voice.Mute := getChildText(aVoiceNode, 'voice_mute') = '1';
    voice.Mono := getChildText(aVoiceNode, 'voice_mono') = '1';
    voice.Color := getChildText(aVoiceNode, 'mindwave_color');

    e := aVoiceNode.FirstChild;
    while e <> nil do
    begin
        if (e.NodeType = ELEMENT_NODE) and (string(e.NodeName) = 'entries') then
        begin
            entryLineNo := 0;
            en := e.FirstChild;
            while en <> nil do
            begin
                if (en.NodeType = ELEMENT_NODE) and (string(en.NodeName) = 'entry') then
                begin
                    entryType := string(TDOMElement(en).GetAttribute('type'));
                    if CompareText(entryType, 'preparse') = 0 then
                        runPreparseEntryGenerator(voice, TDOMElement(en), entryLineNo, aSourceFilePath)
                    else if (CompareText(entryType, 'external') = 0) and
                        (CompareText(string(TDOMElement(en).GetAttribute('input')), 'stdin') = 0) then
                    begin
                        voice.IsExternalStdin := True;
                        voice.ExtInitBase := parseFloat(string(TDOMElement(en).GetAttribute('basefreq')));
                        voice.ExtInitBeat := parseFloat(string(TDOMElement(en).GetAttribute('beatfreq')));
                        voice.ExtInitVolL := parseFloat(string(TDOMElement(en).GetAttribute('volume_left')));
                        voice.ExtInitVolR := parseFloat(string(TDOMElement(en).GetAttribute('volume_right')));
                    end
                    // Once a voice is marked external, subsequent normal entries are ignored
                    else if not voice.IsExternalStdin then
                        parseAndAddEntryNode(voice, TDOMElement(en));

                    Inc(entryLineNo);
                end;
                en := en.NextSibling;
            end;
        end;
        e := e.NextSibling;
    end;

    calibrateVoice(voice);

    // Resolve WAV file path for PCM voices from description field
    if (voice.VoiceType = vtPCM) and (voice.Description <> '') then
    begin
        if ExtractFileDrive(voice.Description) <> '' then
        begin
            // Absolute path (drive-rooted) — use directly without base dir validation
            if FileExists(voice.Description) then
                voice.AudioFilePath := voice.Description
            else
                voice.AudioFilePath := '';
        end
        else
        begin
            resolvedAudioPath := ExpandFileName(FbaseDir + voice.Description);
            voice.AudioFilePath := resolvedAudioPath;
            if (CompareText(Copy(resolvedAudioPath, 1, Length(FbaseDir)), FbaseDir) <> 0) or
                (not FileExists(resolvedAudioPath)) then
                voice.AudioFilePath := '';
        end;
    end;

    SetLength(Fvoices, FvoiceCount + 1);
    Fvoices[FvoiceCount] := voice;
    Inc(FvoiceCount);
end;

procedure TGnauralSchedule.loadFromFile(const aFileName: string);
var
    i: Integer;
    doc: TXMLDocument;
    root, node: TDOMNode;
    s: string;
    sourceFilePath: string;
begin
    for i := 0 to FvoiceCount - 1 do
        FreeAndNil(Fvoices[i]);
    SetLength(Fvoices, 0);
    FvoiceCount := 0;
    FtotalTime := 0;
    sourceFilePath := ExpandFileName(aFileName);
    FbaseDir := IncludeTrailingPathDelimiter(ExtractFilePath(sourceFilePath));

    doc := nil;
    ReadXMLFile(doc, sourceFilePath);
    try
        root := doc.DocumentElement;
        Ftitle := '';
        Fauthor := '';
        Fdescription := '';
        FloopCount := 1;
        FoverallVolLeft := 1.0;
        FoverallVolRight := 1.0;
        FstereoSwap := False;

        node := root.FirstChild;
        while node <> nil do
        begin
            if node.NodeType = ELEMENT_NODE then
            begin
                s := string(node.NodeName);
                if s = 'title' then
                    Ftitle := UTF8Encode(node.TextContent)
                else if s = 'author' then
                    Fauthor := UTF8Encode(node.TextContent)
                else if s = 'schedule_description' then
                    Fdescription := UTF8Encode(node.TextContent)
                else if s = 'loops' then
                    FloopCount := StrToIntDef(UTF8Encode(node.TextContent), 1)
                else if s = 'overallvolume_left' then
                    FoverallVolLeft := parseFloat(UTF8Encode(node.TextContent))
                else if s = 'overallvolume_right' then
                    FoverallVolRight := parseFloat(UTF8Encode(node.TextContent))
                else if s = 'stereoswap' then
                    FstereoSwap := UTF8Encode(node.TextContent) <> '0'
                else if s = 'voice' then
                    parseVoiceNode(node, sourceFilePath);
            end;
            node := node.NextSibling;
        end;
    finally
        FreeAndNil(doc);
    end;
end;

{*******************************************************************************
* getVoice
*******************************************************************************}
function TGnauralSchedule.getVoice(aIndex: Integer): TVoice;
begin
    if (aIndex < 0) or (aIndex >= FvoiceCount) then
        raise Exception.CreateFmt('Voice index out of range: %d', [aIndex]);

    Result := Fvoices[aIndex];
end;

{*******************************************************************************
* scheduleToJson
*******************************************************************************}
function TGnauralSchedule.scheduleToJson: string;
var
    i, j: Integer;
    entry: TScheduleEntry;
    voice: TVoice;
    jsonStream: TStringStream;
begin
    jsonStream := TStringStream.Create('');
    try
        jsonStream.WriteString('{');
        jsonStream.WriteString('"title":"' + jsonEscape(Ftitle) + '"');
        jsonStream.WriteString(',"author":"' + jsonEscape(FAuthor) + '"');
        jsonStream.WriteString(',"description":"' + jsonEscape(Fdescription) + '"');
        jsonStream.WriteString(',"totalTimeSec":' + jsonLogFloat3(FtotalTime));
        jsonStream.WriteString(',"loopCount":' + IntToStr(FloopCount));
        jsonStream.WriteString(',"overallVolL":' + jsonLogFloat3(FoverallVolLeft));
        jsonStream.WriteString(',"overallVolR":' + jsonLogFloat3(FoverallVolRight));
        jsonStream.WriteString(',"stereoSwap":' + jsonBool(FstereoSwap));
        jsonStream.WriteString(',"voiceCount":' + IntToStr(FvoiceCount));
        jsonStream.WriteString(',"voices":[');

        for i := 0 to FvoiceCount - 1 do
        begin
            voice := Fvoices[i];
            if i > 0 then
                jsonStream.WriteString(',');

            jsonStream.WriteString('{');
            jsonStream.WriteString('"id":' + IntToStr(voice.Id));
            jsonStream.WriteString(',"type":"' + jsonEscape(voiceTypeToJsonName(voice.VoiceType)) + '"');
            jsonStream.WriteString(',"typeIndex":' + IntToStr(Ord(voice.VoiceType)));
            jsonStream.WriteString(',"description":"' + jsonEscape(voice.Description) + '"');
            jsonStream.WriteString(',"hidden":' + jsonBool(voice.Hidden));
            jsonStream.WriteString(',"muted":' + jsonBool(voice.Mute));
            jsonStream.WriteString(',"mono":' + jsonBool(voice.Mono));
            if voice.Color <> '' then
                jsonStream.WriteString(',"color":"' + jsonEscape(voice.Color) + '"')
            else
                jsonStream.WriteString(',"color":null');
            jsonStream.WriteString(',"audioFilePath":"' + jsonEscape(voice.AudioFilePath) + '"');
            jsonStream.WriteString(',"totalDurationSec":' + jsonLogFloat3(voice.TotalDuration));
            jsonStream.WriteString(',"entryCount":' + IntToStr(voice.EntryCount));
            jsonStream.WriteString(',"isExternalStdin":' + jsonBool(voice.IsExternalStdin));
            if voice.IsExternalStdin then
            begin
                jsonStream.WriteString(',"extInitBase":' + jsonLogFloat3(voice.ExtInitBase));
                jsonStream.WriteString(',"extInitBeat":' + jsonLogFloat3(voice.ExtInitBeat));
                jsonStream.WriteString(',"extInitVolL":' + jsonLogFloat3(voice.ExtInitVolL));
                jsonStream.WriteString(',"extInitVolR":' + jsonLogFloat3(voice.ExtInitVolR));
            end;
            jsonStream.WriteString(',"entries":[');

            for j := 0 to voice.EntryCount - 1 do
            begin
                entry := voice.getEntry(j);
                if j > 0 then
                    jsonStream.WriteString(',');

                jsonStream.WriteString('{');
                jsonStream.WriteString('"startSec":' + jsonLogFloat3(entry.absoluteStart / GNAURAL_SAMPLE_RATE));
                jsonStream.WriteString(',"endSec":' + jsonLogFloat3(entry.absoluteEnd / GNAURAL_SAMPLE_RATE));
                jsonStream.WriteString(',"durationSec":' + jsonLogFloat3(entry.duration));
                jsonStream.WriteString(',"baseFreqStart":' + jsonLogFloat3(entry.basefreqStart));
                jsonStream.WriteString(',"baseFreqEnd":' + jsonLogFloat3(entry.basefreqEnd));
                jsonStream.WriteString(',"beatFreqHalfStart":' + jsonLogFloat3(entry.beatfreqHalfStart));
                jsonStream.WriteString(',"beatFreqHalfEnd":' + jsonLogFloat3(entry.beatfreqHalfEnd));
                jsonStream.WriteString(',"volLStart":' + jsonLogFloat3(entry.volLstart));
                jsonStream.WriteString(',"volLEnd":' + jsonLogFloat3(entry.volLend));
                jsonStream.WriteString(',"volRStart":' + jsonLogFloat3(entry.volRstart));
                jsonStream.WriteString(',"volREnd":' + jsonLogFloat3(entry.volRend));
                jsonStream.WriteString('}');
            end;

            jsonStream.WriteString(']}');
        end;

        jsonStream.WriteString(']}');
        Result := jsonStream.DataString;
    finally
        FreeAndNil(jsonStream);
    end;
end;

initialization
    gDotFmt := DefaultFormatSettings;
    gDotFmt.DecimalSeparator := '.';
    gDotFmt.ThousandSeparator := ',';

end.
