program HypnosisGenerator;

{$mode objfpc}{$H+}

{
  Preparse generator for hypnosis.gnaural.

  This is a non-clinical demo for calm focus / trance-like relaxation. It does
  not make therapeutic claims. The generator receives --name value pairs from
  the <entry type="preparse"> attributes and prints <entry .../> XML fragments.

  Layers:
    lead    - primary binaural induction wave
    counter - opposite-phase binaural wave for visual/audio motion
    noise   - pink-noise volume envelope (basefreq/beatfreq are zero)
    anchor  - low, slow binaural anchor voice
}

uses
    SysUtils, Math;

var
    argIndex     : Integer;
    argName      : string;
    argValue     : string;
    layer        : string;
    steps        : Integer;
    totalDur     : Double;
    baseCenter   : Double;
    baseRadius   : Double;
    beatStart    : Double;
    beatDeep     : Double;
    beatExit     : Double;
    breathCycles : Double;
    volumeMin    : Double;
    volumeMax    : Double;
    i            : Integer;
    t            : Double;
    segmentDur   : Double;
    baseFreq     : Double;
    beatFreq     : Double;
    volume       : Double;

function Clamp01(const aValue: Double): Double;
begin
    if aValue < 0.0 then
        Result := 0.0
    else if aValue > 1.0 then
        Result := 1.0
    else
        Result := aValue;
end;

function Smooth01(const aValue: Double): Double;
var
    x: Double;
begin
    x := Clamp01(aValue);
    Result := 0.5 - 0.5 * Cos(Pi * x);
end;

function Lerp(const aFrom, aTo, aT: Double): Double;
begin
    Result := aFrom + (aTo - aFrom) * aT;
end;

function BeatCurve(const aT: Double): Double;
begin
    if aT < 0.38 then
        Result := Lerp(beatStart, beatDeep, Smooth01(aT / 0.38))
    else if aT < 0.78 then
        Result := beatDeep + 0.35 * Sin(2.0 * Pi * 3.0 * ((aT - 0.38) / 0.40))
    else
        Result := Lerp(beatDeep, beatExit, Smooth01((aT - 0.78) / 0.22));
end;

function BreathingEnvelope(const aT, aPhase: Double): Double;
var
    breath: Double;
    fadeIn: Double;
    fadeOut: Double;
begin
    breath := 0.5 - 0.5 * Cos(2.0 * Pi * (breathCycles * aT + aPhase));
    fadeIn := Smooth01(aT / 0.10);
    fadeOut := Smooth01((1.0 - aT) / 0.12);
    Result := Lerp(volumeMin, volumeMax, breath) * fadeIn * fadeOut;
end;

begin
    DefaultFormatSettings.DecimalSeparator  := '.';
    DefaultFormatSettings.ThousandSeparator := #0;

    layer        := 'lead';
    steps        := 90;
    totalDur     := 180.0;
    baseCenter   := 185.0;
    baseRadius   := 18.0;
    beatStart    := 10.0;
    beatDeep     := 4.5;
    beatExit     := 8.0;
    breathCycles := 9.0;
    volumeMin    := 0.12;
    volumeMax    := 0.30;

    argIndex := 1;
    while argIndex <= ParamCount - 1 do
    begin
        argName := ParamStr(argIndex);
        argValue := ParamStr(argIndex + 1);

        if      argName = '--layer'         then layer        := LowerCase(argValue)
        else if argName = '--steps'         then steps        := StrToIntDef(argValue, steps)
        else if argName = '--duration'      then totalDur     := StrToFloatDef(argValue, totalDur)
        else if argName = '--base_center'   then baseCenter   := StrToFloatDef(argValue, baseCenter)
        else if argName = '--base_radius'   then baseRadius   := StrToFloatDef(argValue, baseRadius)
        else if argName = '--beat_start'    then beatStart    := StrToFloatDef(argValue, beatStart)
        else if argName = '--beat_deep'     then beatDeep     := StrToFloatDef(argValue, beatDeep)
        else if argName = '--beat_exit'     then beatExit     := StrToFloatDef(argValue, beatExit)
        else if argName = '--breath_cycles' then breathCycles := StrToFloatDef(argValue, breathCycles)
        else if argName = '--volume_min'    then volumeMin    := StrToFloatDef(argValue, volumeMin)
        else if argName = '--volume_max'    then volumeMax    := StrToFloatDef(argValue, volumeMax);

        Inc(argIndex, 2);
    end;

    if steps < 2 then
    begin
        WriteLn(StdErr, 'hypnosis: steps must be >= 2');
        Halt(1);
    end;
    if totalDur <= 0.0 then
    begin
        WriteLn(StdErr, 'hypnosis: duration must be > 0');
        Halt(1);
    end;
    if (layer <> 'lead') and (layer <> 'counter') and (layer <> 'noise') and (layer <> 'anchor') then
    begin
        WriteLn(StdErr, 'hypnosis: --layer must be lead, counter, noise, or anchor');
        Halt(1);
    end;

    segmentDur := totalDur / steps;

    for i := 0 to steps - 1 do
    begin
        t := i / steps;
        beatFreq := BeatCurve(t);

        if layer = 'lead' then
        begin
            baseFreq := baseCenter + baseRadius * Sin(2.0 * Pi * (1.5 * t));
            volume := BreathingEnvelope(t, 0.00);
        end
        else if layer = 'counter' then
        begin
            baseFreq := baseCenter + baseRadius * Sin(2.0 * Pi * (1.5 * t + 0.50));
            beatFreq := beatFreq + 0.25 * Sin(2.0 * Pi * 5.0 * t);
            volume := BreathingEnvelope(t, 0.50);
        end
        else if layer = 'anchor' then
        begin
            baseFreq := baseCenter + baseRadius * Sin(2.0 * Pi * t);
            volume := BreathingEnvelope(t, 0.25);
        end
        else
        begin
            baseFreq := 0.0;
            beatFreq := 0.0;
            volume := BreathingEnvelope(t, 0.10);
        end;

        if (layer <> 'noise') and (beatFreq < 0.1) then
            beatFreq := 0.1;

        WriteLn(Format(
            '<entry duration="%.3f" basefreq="%.3f" beatfreq="%.4f" volume_left="%.3f" volume_right="%.3f"/>',
            [segmentDur, baseFreq, beatFreq, volume, volume]));
    end;
end.
