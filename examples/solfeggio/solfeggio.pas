program SolfeggioGenerator;

{$mode objfpc}{$H+}

{
  Preparse generator for solfeggio.gnaural.

  This is a non-clinical meditation / wellness demo inspired by commonly cited
  solfeggio frequencies. It does not make therapeutic claims. The generator
  receives --name value pairs from the <entry type="preparse"> attributes and
  prints <entry .../> XML fragments.

  Layers:
    lead   - primary binaural voice following the solfeggio frequency path
    halo   - quiet detuned shimmer around the same path
    ground - low anchor derived from the same path via a divisor
    noise  - pink-noise volume envelope (basefreq/beatfreq are zero)
}

uses
    SysUtils, Math;

type
    TDoubleArray = array of Double;

var
    argIndex      : Integer;
    argName       : string;
    argValue      : string;
    layer         : string;
    steps         : Integer;
    totalDur      : Double;
    ascentPortion : Double;
    beatStart     : Double;
    beatDeep      : Double;
    beatExit      : Double;
    breathCycles  : Double;
    volumeMin     : Double;
    volumeMax     : Double;
    detuneHz      : Double;
    divisor       : Double;
    freqText      : string;
    freqs         : TDoubleArray;
    i             : Integer;
    t             : Double;
    segmentDur    : Double;
    solfeggioFreq : Double;
    baseFreq      : Double;
    beatFreq      : Double;
    volume        : Double;

procedure AppendFrequency(var aFreqs: TDoubleArray; const aValue: Double);
var
    count: Integer;
begin
    count := Length(aFreqs);
    SetLength(aFreqs, count + 1);
    aFreqs[count] := aValue;
end;

function ParseFrequencyList(const aText: string): TDoubleArray;
var
    remaining: string;
    token: string;
    commaIndex: Integer;
    value: Double;
begin
    SetLength(Result, 0);
    remaining := Trim(aText);

    while remaining <> '' do
    begin
        commaIndex := Pos(',', remaining);
        if commaIndex > 0 then
        begin
            token := Trim(Copy(remaining, 1, commaIndex - 1));
            Delete(remaining, 1, commaIndex);
        end
        else
        begin
            token := Trim(remaining);
            remaining := '';
        end;

        value := StrToFloatDef(token, 0.0);
        if value > 0.0 then
            AppendFrequency(Result, value);
    end;

    if Length(Result) = 0 then
    begin
        AppendFrequency(Result, 174.0);
        AppendFrequency(Result, 285.0);
        AppendFrequency(Result, 396.0);
        AppendFrequency(Result, 417.0);
        AppendFrequency(Result, 528.0);
        AppendFrequency(Result, 639.0);
        AppendFrequency(Result, 741.0);
        AppendFrequency(Result, 852.0);
        AppendFrequency(Result, 963.0);
    end;
end;

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
    if aT < 0.42 then
        Result := Lerp(beatStart, beatDeep, Smooth01(aT / 0.42))
    else if aT < 0.80 then
        Result := beatDeep + 0.22 * Sin(2.0 * Pi * 3.0 * ((aT - 0.42) / 0.38))
    else
        Result := Lerp(beatDeep, beatExit, Smooth01((aT - 0.80) / 0.20));
end;

function BreathingEnvelope(const aT, aPhase: Double): Double;
var
    breath: Double;
    fadeIn: Double;
    fadeOut: Double;
begin
    breath := 0.5 - 0.5 * Cos(2.0 * Pi * (breathCycles * aT + aPhase));
    fadeIn := Smooth01(aT / 0.08);
    fadeOut := Smooth01((1.0 - aT) / 0.10);
    Result := Lerp(volumeMin, volumeMax, breath) * fadeIn * fadeOut;
end;

function SolfeggioPath(const aT: Double): Double;
var
    count: Integer;
    lastIndex: Integer;
    position: Double;
    index: Integer;
    fraction: Double;
    releaseT: Double;
begin
    count := Length(freqs);
    if count = 1 then
        Exit(freqs[0]);

    lastIndex := count - 1;
    if aT < ascentPortion then
    begin
        position := (aT / ascentPortion) * lastIndex;
        index := Trunc(position);
        if index >= lastIndex then
            Exit(freqs[lastIndex]);

        fraction := position - index;
        Result := Lerp(freqs[index], freqs[index + 1], Smooth01(fraction));
        Exit;
    end;

    releaseT := (aT - ascentPortion) / (1.0 - ascentPortion);
    Result := Lerp(freqs[lastIndex], freqs[0], Smooth01(releaseT));
end;

begin
    DefaultFormatSettings.DecimalSeparator  := '.';
    DefaultFormatSettings.ThousandSeparator := #0;

    layer         := 'lead';
    steps         := 180;
    totalDur      := 180.0;
    ascentPortion := 0.86;
    beatStart     := 8.0;
    beatDeep      := 4.5;
    beatExit      := 7.0;
    breathCycles  := 9.0;
    volumeMin     := 0.08;
    volumeMax     := 0.25;
    detuneHz      := 7.5;
    divisor       := 3.0;
    freqText      := '174,285,396,417,528,639,741,852,963';

    argIndex := 1;
    while argIndex <= ParamCount - 1 do
    begin
        argName := ParamStr(argIndex);
        argValue := ParamStr(argIndex + 1);

        if      argName = '--layer'          then layer         := LowerCase(argValue)
        else if argName = '--steps'          then steps         := StrToIntDef(argValue, steps)
        else if argName = '--duration'       then totalDur      := StrToFloatDef(argValue, totalDur)
        else if argName = '--freqs'          then freqText      := argValue
        else if argName = '--ascent_portion' then ascentPortion := StrToFloatDef(argValue, ascentPortion)
        else if argName = '--beat_start'     then beatStart     := StrToFloatDef(argValue, beatStart)
        else if argName = '--beat_deep'      then beatDeep      := StrToFloatDef(argValue, beatDeep)
        else if argName = '--beat_exit'      then beatExit      := StrToFloatDef(argValue, beatExit)
        else if argName = '--breath_cycles'  then breathCycles  := StrToFloatDef(argValue, breathCycles)
        else if argName = '--volume_min'     then volumeMin     := StrToFloatDef(argValue, volumeMin)
        else if argName = '--volume_max'     then volumeMax     := StrToFloatDef(argValue, volumeMax)
        else if argName = '--detune_hz'      then detuneHz      := StrToFloatDef(argValue, detuneHz)
        else if argName = '--divisor'        then divisor       := StrToFloatDef(argValue, divisor);

        Inc(argIndex, 2);
    end;

    if steps < 2 then
    begin
        WriteLn(StdErr, 'solfeggio: steps must be >= 2');
        Halt(1);
    end;
    if totalDur <= 0.0 then
    begin
        WriteLn(StdErr, 'solfeggio: duration must be > 0');
        Halt(1);
    end;
    if (ascentPortion <= 0.1) or (ascentPortion >= 0.95) then
    begin
        WriteLn(StdErr, 'solfeggio: ascent_portion must be between 0.1 and 0.95');
        Halt(1);
    end;
    if divisor <= 0.0 then
    begin
        WriteLn(StdErr, 'solfeggio: divisor must be > 0');
        Halt(1);
    end;
    if (layer <> 'lead') and (layer <> 'halo') and (layer <> 'ground') and (layer <> 'noise') then
    begin
        WriteLn(StdErr, 'solfeggio: --layer must be lead, halo, ground, or noise');
        Halt(1);
    end;

    freqs := ParseFrequencyList(freqText);
    segmentDur := totalDur / steps;

    for i := 0 to steps - 1 do
    begin
        t := i / (steps - 1);
        solfeggioFreq := SolfeggioPath(t);
        beatFreq := BeatCurve(t);

        if layer = 'lead' then
        begin
            baseFreq := solfeggioFreq;
            volume := BreathingEnvelope(t, 0.00);
        end
        else if layer = 'halo' then
        begin
            baseFreq := solfeggioFreq + detuneHz * Sin(2.0 * Pi * (4.0 * t + 0.25));
            beatFreq := beatFreq + 0.30 * Sin(2.0 * Pi * 5.0 * t);
            volume := BreathingEnvelope(t, 0.50);
        end
        else if layer = 'ground' then
        begin
            baseFreq := solfeggioFreq / divisor;
            volume := BreathingEnvelope(t, 0.25);
        end
        else
        begin
            baseFreq := 0.0;
            beatFreq := 0.0;
            volume := BreathingEnvelope(t, 0.12);
        end;

        if (layer <> 'noise') and (beatFreq < 0.1) then
            beatFreq := 0.1;

        WriteLn(Format(
            '<entry duration="%.3f" basefreq="%.3f" beatfreq="%.4f" volume_left="%.3f" volume_right="%.3f"/>',
            [segmentDur, baseFreq, beatFreq, volume, volume]));
    end;
end.
