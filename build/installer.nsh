; ============================================================================
; installer.nsh — electron-builder 的 NSIS 自定义脚本
; （electron-builder 默认读 build/installer.nsh，安装程序和卸载程序编译时都会包含它）
;
; 卸载时：
;   - 卸载向导第一页加"同时删除我的数据"勾选框，默认不勾。
;     从设置页"卸载软件…"打开时带 --delete-user-data / --keep-user-data（src/uninstaller.js），
;     勾选框按设置页的选择预先勾好。
;   - 勾了就删 %APPDATA%\interactive-desktop-wallpaper（设置、导入的元素、深度图、日志），
;     以及卸载清单 uninstall_extra_files.txt 里列的、放在别处的深度图（src/store.js 写的）。
;     用户自己的原图、音乐、封面软件只记了路径，不删。
;   - 不管勾没勾，都删掉指向安装目录的开机自启项（不然卸载后系统还会去启动不存在的程序），
;     以及 electron-builder 留下的空安装文件夹。
;   - 装新版本覆盖旧版本时，旧版卸载程序带 --updated 在后台运行：这时什么都不删。
; ============================================================================

!ifdef BUILD_UNINSTALLER

!include LogicLib.nsh
!include FileFunc.nsh

!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define STARTUP_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define UNINSTALL_LIST_FILE "uninstall_extra_files.txt"

Var deleteUserData        ; "1" = 删除用户数据
Var deleteDataCheckbox

!macro customUnInit
  StrCpy $deleteUserData "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-user-data" $R1
  ${IfNot} ${Errors}
    StrCpy $deleteUserData "1"
  ${EndIf}
!macroend

; 用 MUI 自带的欢迎页，显示时在说明文字下面加一个勾选框
!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.welcomeShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.welcomeLeave
  !insertmacro MUI_UNPAGE_WELCOME

  Function un.welcomeShow
    ; 跟着卸载向导的界面语言：简体、繁体，其他语言显示英文
    ${If} $LANGUAGE == 2052
      StrCpy $0 "同时删除我的数据（设置、导入的元素、深度图）"
    ${ElseIf} $LANGUAGE == 1028
      StrCpy $0 "同時刪除我的資料（設定、匯入的元素、深度圖）"
    ${Else}
      StrCpy $0 "Also delete my data (settings, imported elements, depth maps)"
    ${EndIf}
    ; 欢迎页 193u 高，说明文字占到 168u
    ${NSD_CreateCheckbox} 120u 168u 195u 22u $0
    Pop $deleteDataCheckbox
    SetCtlColors $deleteDataCheckbox "" "${MUI_BGCOLOR}"
    ${If} $deleteUserData == "1"
      ${NSD_Check} $deleteDataCheckbox
    ${EndIf}
  FunctionEnd

  Function un.welcomeLeave
    ${NSD_GetState} $deleteDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $deleteUserData "1"
    ${Else}
      StrCpy $deleteUserData "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; electron-builder 在 un.onInit 里把当前目录设成了安装目录，它自己的 RMDir /r 删不掉这一层，会留下空文件夹。
    ; 换个当前目录再删（不带 /r，里面还有东西就不删）
    SetOutPath $TEMP
    RMDir $INSTDIR
    Call un.removeAutoLaunch
    ${If} $deleteUserData == "1"
      ; Electron 的数据只按当前用户存（为所有用户安装时也一样）
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      ; 清单在数据文件夹里，要先读清单、再删文件夹
      Call un.deleteListedFiles
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${EndIf}
  ${endIf}
!macroend

; 删掉指向安装目录的开机自启项。项的名字由 Electron 决定，按启动命令找更稳
Function un.removeAutoLaunch
  StrLen $R3 "$INSTDIR\"
  StrCpy $R0 0
  loop:
    ClearErrors
    EnumRegValue $R1 HKCU "${RUN_KEY}" $R0
    ${If} ${Errors}
    ${OrIf} $R1 == ""
      Goto done
    ${EndIf}
    ReadRegStr $R2 HKCU "${RUN_KEY}" $R1
    ; 命令一般是 "C:\...\互动3D壁纸.exe" --autostart，去掉开头的引号再比较
    StrCpy $R4 $R2 1
    ${If} $R4 == '"'
      StrCpy $R2 $R2 "" 1
    ${EndIf}
    StrCpy $R2 $R2 $R3
    ${If} $R2 == "$INSTDIR\"
      DeleteRegValue HKCU "${RUN_KEY}" $R1
      DeleteRegValue HKCU "${STARTUP_APPROVED_KEY}" $R1
      ; 删掉以后后面的项往前挪，同一个序号再读一次
      Goto loop
    ${EndIf}
    IntOp $R0 $R0 + 1
    Goto loop
  done:
FunctionEnd

; 按卸载清单删除放在数据文件夹以外的深度图（UTF-16LE 带 BOM，一行一个完整路径）。
; 删完文件夹空了才删文件夹，里面有别的东西就不动
Function un.deleteListedFiles
  StrCpy $R0 "$APPDATA\${APP_PACKAGE_NAME}\${UNINSTALL_LIST_FILE}"
  IfFileExists $R0 0 done
  ClearErrors
  FileOpen $R1 $R0 r
  IfErrors done
  ; 跳过 BOM（0xFEFF）
  FileReadWord $R1 $R2
  ${If} $R2 != 65279
    FileSeek $R1 0 SET
  ${EndIf}
  loop:
    ClearErrors
    FileReadUTF16LE $R1 $R2
    IfErrors close
    ; 去掉行尾的换行
    trim:
      StrCpy $R3 $R2 1 -1
      ${If} $R3 == "$\r"
      ${OrIf} $R3 == "$\n"
        StrCpy $R2 $R2 -1
        Goto trim
      ${EndIf}
    ; 只删软件自己生成的深度图（depth_<hash>.png，见 store.js 的 _hashPath），清单被改过也删不到别的文件
    ${GetFileName} $R2 $R3
    StrCpy $R4 $R3 6
    StrCpy $R5 $R3 "" -4
    ${If} $R4 == "depth_"
    ${AndIf} $R5 == ".png"
      Delete $R2
      ${GetParent} $R2 $R3
      RMDir $R3
    ${EndIf}
    Goto loop
  close:
    FileClose $R1
  done:
FunctionEnd

!endif
