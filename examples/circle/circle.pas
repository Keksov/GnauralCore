program CircleGenerator;

{$mode objfpc}{$H+}

{
  Preparse generator for circle.gnaural.

  Receives parameters from the <entry type="preparse"> attributes as
  --name value pairs (plus --gnaural_file and --line_no which are ignored).

  Outputs N <entry .../> lines to stdout; each represents one equal-duration
  segment of a sinusoidal frequency circle:

    base_freq: one full sine sweep from base_min to base_max and back,
               completing exactly 1 cycle over the total duration.

    beat_freq: independent sine oscillation between beat_min and beat_max,
               completing beat_cycles full cycles over the total duration.

  Parameters (all optional, defaults shown):
    --steps       60      number of output entries
    --base_min    80.0    minimum base frequency (Hz)
    --base_max    200.0   maximum base frequency (Hz)
    --beat_min    0.5     minimum beat frequency (Hz)
    --beat_max    5.0     maximum beat frequency (Hz)
    --beat_cycles 3.0     independent beat cycles per total duration
    --duration    60.0    total schedule duration (seconds)
    --volume_left  0.9
    --volume_right 0.9
}

uses
    SysUtils;

var
    argIndex    : Integer;
    argName     : string;
    argValue    : string;
    steps       : Integer;
    baseMin     : Double;
    baseMax     : Double;
    beatMin     : Double;
    beatMax     : Double;
    beatCycles  : Double;
    totalDur    : Double;
    volumeLeft  : Double;
    volumeRight : Double;
    i           : Integer;
    phase       : Double;
    beatPhase   : Double;
    baseFreq    : Double;
    beatFreq    : Double;
    segDuration : Double;

begin
    { Force decimal point regardless of system locale }
    DefaultFormatSettings.DecimalSeparator  := '.';
    DefaultFormatSettings.ThousandSeparator := #0;

    { Defaults }
    steps       := 60;
    baseMin     := 80.0;
    baseMax     := 200.0;
    beatMin     := 0.5;
    beatMax     := 5.0;
    beatCycles  := 3.0;
    totalDur    := 60.0;
    volumeLeft  := 0.9;
    volumeRight := 0.9;

    { Parse --name value pairs; skip unrecognised names (e.g. --gnaural_file, --line_no) }
    argIndex := 1;
    while argIndex <= ParamCount - 1 do
    begin
        argName  := ParamStr(argIndex);
        argValue := ParamStr(argIndex + 1);
        if      argName = '--steps'        then steps      := StrToIntDef(argValue, steps)
        else if argName = '--base_min'     then baseMin    := StrToFloatDef(argValue, baseMin)
        else if argName = '--base_max'     then baseMax    := StrToFloatDef(argValue, baseMax)
        else if argName = '--beat_min'     then beatMin    := StrToFloatDef(argValue, beatMin)
        else if argName = '--beat_max'     then beatMax    := StrToFloatDef(argValue, beatMax)
        else if argName = '--beat_cycles'  then beatCycles := StrToFloatDef(argValue, beatCycles)
        else if argName = '--duration'     then totalDur   := StrToFloatDef(argValue, totalDur)
        else if argName = '--volume_left'  then volumeLeft := StrToFloatDef(argValue, volumeLeft)
        else if argName = '--volume_right' then volumeRight:= StrToFloatDef(argValue, volumeRight);
        Inc(argIndex, 2);
    end;

    { Validate }
    if steps < 1 then
    begin
        WriteLn(StdErr, 'circle: steps must be >= 1');
        Halt(1);
    end;
    if totalDur <= 0.0 then
    begin
        WriteLn(StdErr, 'circle: duration must be > 0');
        Halt(1);
    end;

    segDuration := totalDur / steps;

    {
      For step i (0..steps-1):
        phase     = i / steps  in [0, 1)
        base_freq = base_min + (base_max - base_min) * (0.5 - 0.5*cos(2*pi*phase))
                  → starts at base_min, peaks at base_max at midpoint, returns to base_min

        beatPhase = beat_cycles * i / steps  in [0, beat_cycles)
        beat_freq = beat_min + (beat_max - beat_min) * (0.5 - 0.5*cos(2*pi*beatPhase))
                  → faster independent oscillation

      The gnaural engine interpolates each entry's value toward the next entry's value,
      and the last entry wraps to the first — so the circle is seamlessly cyclic.
    }
    for i := 0 to steps - 1 do
    begin
        phase     := i / steps;
        beatPhase := beatCycles * i / steps;

        baseFreq := baseMin + (baseMax - baseMin) * (0.5 - 0.5 * Cos(2.0 * Pi * phase));
        beatFreq := beatMin + (beatMax - beatMin) * (0.5 - 0.5 * Cos(2.0 * Pi * beatPhase));

        WriteLn(Format(
            '<entry duration="%.3f" basefreq="%.3f" beatfreq="%.4f" volume_left="%.2f" volume_right="%.2f"/>',
            [segDuration, baseFreq, beatFreq, volumeLeft, volumeRight]));
    end;
end.
