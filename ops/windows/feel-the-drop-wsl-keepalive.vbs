Option Explicit

Dim shell, exitCode
Set shell = CreateObject("WScript.Shell")

exitCode = shell.Run( _
  """C:\Windows\System32\wsl.exe"" -d Ubuntu --user root --exec /usr/bin/sleep infinity", _
  0, _
  True _
)

WScript.Quit exitCode
