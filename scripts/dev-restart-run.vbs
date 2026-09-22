Set sh = CreateObject("WScript.Shell")
cmd = Chr(34) & "E:/software/Nodejs/node.exe" & Chr(34) & " " & Chr(34) & "F:/Work/Create/desk_pet/desk-pet/scripts/dev-restart-worker.js" & Chr(34)
sh.Run cmd, 0, False
