program CircleGenerator;

{$mode objfpc}{$H+}

{
  Preparse generator for circle.gnaural.

  Receives parameters from the <entry type="preparse"> attributes as
  --name value pairs (plus --gnaural_file and --line_no which are ignored).

  Outputs N <entry .../> lines to stdout for one semicircular arc.
  Two instances (arc=upper + arc=lower) together draw a full circle in the
  time-vs-frequency chart, starting and ending at center = (base_min+base_max)/2.

    base_freq  upper arc: center + radius * sin(Pi * phase)  (center → max → center)
               lower arc: center - radius * sin(Pi * phase)  (center → min → center)

    beat_freq: independent sine oscillation between beat_min and beat_max,
               completing beat_cycles full cycles over the total duration.

  Parameters (all optional, defaults shown):
    --arc         upper   which semicircle: upper (→ base_max) or lower (→ base_min)
    --steps       60      number of output entries
    --base_min    80.0    lower arc peak frequency (Hz)
    --base_max    200.0   upper arc peak frequency (Hz)
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
    arc         : string;
    arcSign     : Double;
    center      : Double;
    radius      : Double;
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
    arc         := 'upper';

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
        else if argName = '--volume_right' then volumeRight:= StrToFloatDef(argValue, volumeRight)
        else if argName = '--arc'           then arc         := argValue;
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
    center      := (baseMin + baseMax) / 2.0;
    radius      := (baseMax - baseMin) / 2.0;

    if arc = 'upper' then
        arcSign := 1.0
    else if arc = 'lower' then
        arcSign := -1.0
    else
    begin
        WriteLn(StdErr, 'circle: --arc must be "upper" or "lower"');
        Halt(1);
    end;

    {
            For step i (0..steps-1):
                phase     = i / steps  in [0, 1)
                u         = 2*phase - 1 in [-1, 1)
                base_freq = center ± radius * sqrt(1 - u*u)
                                    upper: upper semicircle of x^2 + y^2 = radius^2
                                    lower: lower semicircle of x^2 + y^2 = radius^2

        beatPhase = beat_cycles * i / steps  in [0, beat_cycles)
        beat_freq = beat_min + (beat_max - beat_min) * (0.5 - 0.5*cos(2*pi*beatPhase))
                  → faster independent oscillation

      The two arcs together form one closed circle in the time-vs-frequency chart.
      The gnaural engine interpolates each entry toward the next; the last entry
      wraps to the first — so the circle loops cleanly.
    }
    for i := 0 to steps - 1 do
    begin
        phase     := i / steps;
        beatPhase := beatCycles * i / steps;

        phase := 2.0 * phase - 1.0;
        baseFreq := center + arcSign * radius * Sqrt(1.0 - phase * phase);
        beatFreq := beatMin + (beatMax - beatMin) * (0.5 - 0.5 * Cos(2.0 * Pi * beatPhase));

        WriteLn(Format(
            '<entry duration="%.3f" basefreq="%.3f" beatfreq="%.4f" volume_left="%.2f" volume_right="%.2f"/>',
            [segDuration, baseFreq, beatFreq, volumeLeft, volumeRight]));
    end;
end.
