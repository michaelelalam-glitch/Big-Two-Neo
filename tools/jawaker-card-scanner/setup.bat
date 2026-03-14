@echo off
title Saudi Deal Card Scanner — Setup
echo ============================================================
echo  Saudi Deal Card Scanner — One-time Setup
echo ============================================================
echo.

REM ── Step 1: Check Python ─────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+
    echo         from https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [OK] Python found.

REM ── Step 2: Install Python packages ──────────────────────────
echo.
echo Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install failed. Check your internet connection.
    pause
    exit /b 1
)
echo [OK] Python packages installed.

REM ── Step 3: Check Tesseract ───────────────────────────────────
echo.
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
    echo [OK] Tesseract found at default location.
) else (
    echo [WARNING] Tesseract NOT found at C:\Program Files\Tesseract-OCR\
    echo.
    echo  You must install Tesseract with Arabic language support:
    echo.
    echo  1. Download the installer from:
    echo     https://github.com/UB-Mannheim/tesseract/wiki
    echo     ^(Get the latest Windows 64-bit installer^)
    echo.
    echo  2. During install, expand "Additional language data"
    echo     and check "Arabic" to install the Arabic OCR model.
    echo.
    echo  3. Use the default install path:
    echo     C:\Program Files\Tesseract-OCR\
    echo.
    echo  After installing Tesseract, re-run this setup to confirm.
    echo.
    pause
    exit /b 1
)

REM ── Step 4: Check Arabic language pack ───────────────────────
if exist "C:\Program Files\Tesseract-OCR\tessdata\ara.traineddata" (
    echo [OK] Arabic language pack found.
) else (
    echo [WARNING] Arabic language pack ^(ara.traineddata^) not found.
    echo.
    echo  Download it and place it in:
    echo  C:\Program Files\Tesseract-OCR\tessdata\
    echo.
    echo  Download from:
    echo  https://github.com/tesseract-ocr/tessdata/blob/main/ara.traineddata
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Setup complete! To start scanning:
echo.
echo    1. Open BlueStacks and start a Saudi Deal game
echo    2. Run:  python scanner.py
echo ============================================================
echo.
pause
