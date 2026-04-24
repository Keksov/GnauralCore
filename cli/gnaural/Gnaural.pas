program Gnaural;

{$mode objfpc}{$H+}

uses
    SysUtils,
    GnauralSchedule in 'core\GnauralSchedule.pas',
    GnauralVoiceSynth in 'core\GnauralVoiceSynth.pas',
    GnauralWavReader in 'core\GnauralWavReader.pas',
    GnauralSynth in 'core\GnauralSynth.pas',
    GnauralAudioOutput in 'core\GnauralAudioOutput.pas',
    GnauralWavWriter in 'core\GnauralWavWriter.pas',
    GnauralApp in 'core\GnauralApp.pas';

var
    app: TGnauralApp;
begin
    app := nil;
    try
        ExitCode := 0;
        try
            app := TGnauralApp.Create;
            ExitCode := app.run;
        except
            on E: Exception do
            begin
                ExitCode := 255;
                WriteLn(ErrOutput, 'Error: ', E.ClassName, ': ', E.Message);
            end;
        end;
    finally
        FreeAndNil(app);
    end;
end.
