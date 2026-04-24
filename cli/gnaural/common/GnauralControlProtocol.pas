unit GnauralControlProtocol;

{$mode objfpc}{$H+}

interface

uses
    SysUtils,
    fpjson,
    jsonparser,
    LogCore;

type
    TGnauralCmdType = (
        gctUnknown,
        gctLoad,
        gctStart,
        gctPause,
        gctResume,
        gctSeek,
        gctSetVolume,
        gctMuteVoice,
        gctStop,
        gctQuit
    );

    TGnauralCommand = record
        CmdType              : TGnauralCmdType;
        FileName             : string;
        PositionSec          : Double;
        LeftVolume           : Double;
        RightVolume          : Double;
        VoiceId              : Integer;
        Muted                : Boolean;
    end;

function    parseGnauralCommand(const aLine: string;
            out aCmd: TGnauralCommand): Boolean;
function    makeGnauralAck(const aCmdName: string; aOk: Boolean;
            const aError: string = ''): string;

implementation

{*******************************************************************************
* tryGetJsonString
*******************************************************************************}
function tryGetJsonString(aObj: TJSONObject; const aName: string;
    out aValue: string): Boolean;
var
    i: Integer;
    data: TJSONData;
begin
    Result := False;
    aValue := '';

    i := aObj.IndexOfName(aName);
    if i < 0 then
        Exit;

    data := aObj.Items[i];
    if (data = nil) or (data.JSONType <> jtString) then
        Exit;

    aValue := data.AsString;
    Result := True;
end;

{*******************************************************************************
* tryGetJsonFloat
*******************************************************************************}
function tryGetJsonFloat(aObj: TJSONObject; const aName: string;
    out aValue: Double): Boolean;
var
    i: Integer;
    data: TJSONData;
begin
    Result := False;
    aValue := 0.0;

    i := aObj.IndexOfName(aName);
    if i < 0 then
        Exit;

    data := aObj.Items[i];
    if (data = nil) or (data.JSONType <> jtNumber) then
        Exit;

    try
        aValue := data.AsFloat;
        Result := True;
    except
        Result := False;
    end;
end;

{*******************************************************************************
* tryGetJsonInteger
*******************************************************************************}
function tryGetJsonInteger(aObj: TJSONObject; const aName: string;
    out aValue: Integer): Boolean;
var
    i: Integer;
    data: TJSONData;
begin
    Result := False;
    aValue := 0;

    i := aObj.IndexOfName(aName);
    if i < 0 then
        Exit;

    data := aObj.Items[i];
    if (data = nil) or (data.JSONType <> jtNumber) then
        Exit;

    try
        aValue := data.AsInteger;
        Result := True;
    except
        Result := False;
    end;
end;

{*******************************************************************************
* tryGetJsonBoolean
*******************************************************************************}
function tryGetJsonBoolean(aObj: TJSONObject; const aName: string;
    out aValue: Boolean): Boolean;
var
    i: Integer;
    data: TJSONData;
begin
    Result := False;
    aValue := False;

    i := aObj.IndexOfName(aName);
    if i < 0 then
        Exit;

    data := aObj.Items[i];
    if (data = nil) or (data.JSONType <> jtBoolean) then
        Exit;

    try
        aValue := data.AsBoolean;
        Result := True;
    except
        Result := False;
    end;
end;

{*******************************************************************************
* parseGnauralCommand
*******************************************************************************}
function parseGnauralCommand(const aLine: string;
    out aCmd: TGnauralCommand): Boolean;
var
    obj: TJSONObject;
    data: TJSONData;
    cmdText: string;
begin
    Result := False;
    aCmd.CmdType := gctUnknown;
    aCmd.FileName := '';
    aCmd.PositionSec := 0.0;
    aCmd.LeftVolume := 1.0;
    aCmd.RightVolume := 1.0;
    aCmd.VoiceId := -1;
    aCmd.Muted := False;

    if Trim(aLine) = '' then
        Exit;

    data := nil;
    try
        try
            data := GetJSON(aLine);
        except
            Exit;
        end;

        if not (data is TJSONObject) then
            Exit;

        obj := TJSONObject(data);
        if not tryGetJsonString(obj, 'cmd', cmdText) then
            Exit;

        cmdText := LowerCase(Trim(cmdText));
        if cmdText = 'load' then
        begin
            if not tryGetJsonString(obj, 'file', aCmd.FileName) then
                Exit;

            aCmd.CmdType := gctLoad;
            Result := Trim(aCmd.FileName) <> '';
            Exit;
        end;

        if cmdText = 'start' then
        begin
            aCmd.CmdType := gctStart;
            Result := True;
            Exit;
        end;

        if cmdText = 'pause' then
        begin
            aCmd.CmdType := gctPause;
            Result := True;
            Exit;
        end;

        if cmdText = 'resume' then
        begin
            aCmd.CmdType := gctResume;
            Result := True;
            Exit;
        end;

        if cmdText = 'seek' then
        begin
            if not tryGetJsonFloat(obj, 'pos', aCmd.PositionSec) then
                Exit;

            aCmd.CmdType := gctSeek;
            if aCmd.PositionSec < 0.0 then
                Exit;
            Result := True;
            Exit;
        end;

        if cmdText = 'set_volume' then
        begin
            if (not tryGetJsonFloat(obj, 'left', aCmd.LeftVolume)) or
                (not tryGetJsonFloat(obj, 'right', aCmd.RightVolume)) then
                Exit;

            aCmd.CmdType := gctSetVolume;
            if (aCmd.LeftVolume < 0.0) or (aCmd.LeftVolume > 1.0) or
                (aCmd.RightVolume < 0.0) or (aCmd.RightVolume > 1.0) then
                Exit;
            Result := True;
            Exit;
        end;

        if cmdText = 'mute_voice' then
        begin
            if (not tryGetJsonInteger(obj, 'voice_id', aCmd.VoiceId)) or
                (not tryGetJsonBoolean(obj, 'muted', aCmd.Muted)) then
                Exit;

            aCmd.CmdType := gctMuteVoice;
            if aCmd.VoiceId < 0 then
                Exit;
            Result := True;
            Exit;
        end;

        if cmdText = 'stop' then
        begin
            aCmd.CmdType := gctStop;
            Result := True;
            Exit;
        end;

        if cmdText = 'quit' then
        begin
            aCmd.CmdType := gctQuit;
            Result := True;
            Exit;
        end;
    finally
        FreeAndNil(data);
    end;
end;

{*******************************************************************************
* makeGnauralAck
*******************************************************************************}
function makeGnauralAck(const aCmdName: string; aOk: Boolean;
    const aError: string): string;
begin
    if aOk then
        Result := '{"event":"stdio_ack","cmd":"' +
            jsonEscape(aCmdName) + '","ok":true}'
    else
        Result := '{"event":"stdio_ack","cmd":"' +
            jsonEscape(aCmdName) + '","ok":false,"error":"' +
            jsonEscape(aError) + '"}';
end;

end.