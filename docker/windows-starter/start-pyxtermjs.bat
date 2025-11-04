@echo off
REM ============================================
REM Pyxtermjs Docker Container Starter
REM ============================================

REM Check if BUSID argument was provided
if "%~1"=="" (
    echo No BUSID provided. Listing available USB devices...
    echo.
    echo ============================================
    usbipd list
    echo ============================================
    echo.
    echo Usage: start-pyxtermjs.bat ^<BUSID^>
    echo Example: start-pyxtermjs.bat 5-1
    echo.
    echo Find your device BUSID in the list above and run:
    echo   start-pyxtermjs.bat ^<BUSID^>
    exit /b 1
)

REM Display current USB devices
echo Listing USB devices...
echo ============================================
usbipd list
echo ============================================
echo.

REM Bind the device (one-time, but safe to run multiple times)
echo Binding device %1 (if not already bound)...
usbipd bind --busid %1 2>nul

REM Detach device if already attached (ignore errors if not attached)
echo Detaching device if already attached...
usbipd detach --busid %1 2>nul
timeout /t 1 /nobreak >nul

REM Attach the USB device to WSL
echo Attaching USB device %1 to WSL...
usbipd attach --wsl --busid %1

REM Wait for device to be ready in WSL (takes a few seconds)
echo Waiting for device to be ready...
timeout /t 3 /nobreak >nul

REM Start the Docker container with the USB device
echo Starting Docker container...
echo Container will be available at http://localhost:5000
echo.
wsl -e bash -c "docker run -it -p 5000:5000 --device=/dev/ttyACM0:/dev/ttyACM0 edryslabs/module-pyxtermjs:latest"