Option Explicit
Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = "node.exe """ & root & "\scripts\start-local.mjs"""
result = shell.Run(command, 0, True)
If result <> 0 Then
  MsgBox "DisyLab could not start. See .local\run\startup-error.txt in the project folder. Install Node.js and run npm ci if this is your first launch.", vbExclamation, "DisyLab"
End If
