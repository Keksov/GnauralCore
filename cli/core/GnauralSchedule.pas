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

public
    constructor Create;
    destructor  Destroy; override;

    procedure   addEntry(const aEntry: TScheduleEntry);
    function    getEntry(aIndex: Integer): TScheduleEntry;

    property Id             : Integer   read Fid           write Fid;
    property VoiceType      : TVoiceType read FvoiceType   write FvoiceType;
    property Hidden         : Boolean   read Fhidden       write Fhidden;
    property Mute           : Boolean   read Fmute         write Fmute;
    property Mono           : Boolean   read Fmono         write Fmono;
    property Color          : string    read Fcolor        write Fcolor;
    property Description    : string    read Fdescription  write Fdescription;
    property AudioFilePath  : string    read FaudioFilePath write FaudioFilePath;
    property TotalDuration  : Double    read FtotalDuration;
    property EntryCount     : Integer   read FentryCount;
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
    procedure   calibrateVoice(aVoice: TVoice);
    procedure   parseVoiceNode(aVoiceNode: TDOMNode);

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

procedure TGnauralSchedule.parseVoiceNode(aVoiceNode: TDOMNode);
var
    e, en: TDOMNode;
    voice: TVoice;
    entry: TScheduleEntry;
    typeInt: Integer;
    resolvedAudioPath: string;
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
            en := e.FirstChild;
            while en <> nil do
            begin
                if (en.NodeType = ELEMENT_NODE) and (string(en.NodeName) = 'entry') then
                begin
                    FillChar(entry, SizeOf(entry), 0);
                    entry.duration        := parseFloat(string(TDOMElement(en).GetAttribute('duration')));
                    entry.volLstart       := parseFloat(string(TDOMElement(en).GetAttribute('volume_left')));
                    entry.volRstart       := parseFloat(string(TDOMElement(en).GetAttribute('volume_right')));
                    entry.beatfreqHalfStart := parseFloat(string(TDOMElement(en).GetAttribute('beatfreq'))) / 2;
                    entry.basefreqStart   := parseFloat(string(TDOMElement(en).GetAttribute('basefreq')));
                    voice.addEntry(entry);
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
begin
    for i := 0 to FvoiceCount - 1 do
        FreeAndNil(Fvoices[i]);
    SetLength(Fvoices, 0);
    FvoiceCount := 0;
    FtotalTime := 0;
    FbaseDir := IncludeTrailingPathDelimiter(ExtractFilePath(ExpandFileName(aFileName)));

    doc := nil;
    ReadXMLFile(doc, aFileName);
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
                    parseVoiceNode(node);
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
