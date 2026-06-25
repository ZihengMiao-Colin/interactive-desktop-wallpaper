@echo off
chcp 65001 >nul 2>nul
cls
echo ============================================================
echo   互动桌面壁纸 - 深度图生成工具
echo   使用 Depth Anything V2 (Hugging Face Transformers)
echo ============================================================
echo.

python --version >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python，请先安装 Python 3.9+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

python -c "import transformers" >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 首次运行需要安装依赖库...
    echo.
    echo 正在执行: pip install -r requirements.txt
    echo.
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败，请手动执行:
        echo   pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo.
    echo [完成] 依赖安装成功！
    echo.
)

echo ============================================================
echo   请将图片文件拖入此窗口，然后按回车
echo   或者直接输入图片路径
echo ============================================================
echo.

set /p IMAGE_PATH="图片路径: "

set IMAGE_PATH=%IMAGE_PATH:"=%

if "%IMAGE_PATH%"=="" (
    echo [错误] 未输入任何路径
    pause
    exit /b 1
)

if not exist "%IMAGE_PATH%" (
    echo [错误] 找不到文件: %IMAGE_PATH%
    pause
    exit /b 1
)

echo.
echo 选择模型大小:
echo   [1] Small  - 快速 (推荐，约 100MB)
echo   [2] Base   - 均衡 (约 390MB)
echo   [3] Large  - 最佳质量 (约 1.3GB，需要 GPU)
echo.

set /p MODEL_CHOICE="请输入编号 (1/2/3，默认 1): "

if "%MODEL_CHOICE%"=="3" (
    set MODEL=large
) else if "%MODEL_CHOICE%"=="2" (
    set MODEL=base
) else (
    set MODEL=small
)

echo.
echo ============================================================
echo   开始生成深度图...
echo   模型: %MODEL%
echo   输入: %IMAGE_PATH%
echo ============================================================
echo.

python generate_depth_map.py "%IMAGE_PATH%" -o "depth_map.png" -m %MODEL%

echo.
echo ============================================================
if %errorlevel% equ 0 (
    echo   [完成] depth_map.png 已生成。
    echo   将它与 background.png 放在同一目录即可使用。
) else (
    echo   [失败] 生成失败，请检查上方错误信息。
)
echo ============================================================

pause
