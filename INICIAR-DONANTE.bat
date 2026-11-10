@echo off
rem ============================================================================
rem  DONANTE N.º ____ : arranque de la exposicion SIN OPERADOR.
rem  Doble clic (o ponerlo en Inicio de Windows) y la obra queda andando sola:
rem    1. arma la obra si todavia no esta armada (carpeta dist);
rem    2. levanta el servidor local (sin internet);
rem    3. abre Chrome a pantalla completa (modo kiosco), con la camara permitida
rem       y el sonido sin tener que tocar una tecla.
rem  Para salir: Alt+F4.  Para re-armar despues de cambiar el codigo:
rem    INICIAR-DONANTE.bat armar
rem ============================================================================
cd /d "%~dp0"

if /i "%~1"=="armar" goto :build
if not exist "dist\index.html" goto :build
goto :serve

:build
echo Armando la obra...
call npm run build
if errorlevel 1 goto :error

:serve
start "DONANTE servidor" /min cmd /c "npx vite preview --port 4173 --strictPort"

rem Espera a que el servidor responda (hasta 30 s).
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul http://localhost:4173/ && goto :open
set /a tries+=1
if %tries% lss 30 goto :wait
echo El servidor no respondio.
goto :error

:open
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" goto :nochrome

rem Perfil propio de la exposicion: ahi se guardan el contador y los ajustes (G -> Guardar).
start "" "%CHROME%" --kiosk --user-data-dir="%LocalAppData%\donante-kiosco" ^
  --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream ^
  --no-first-run --no-default-browser-check --noerrdialogs --disable-session-crashed-bubble ^
  --disable-infobars --disable-features=Translate --overscroll-history-navigation=0 ^
  http://localhost:4173/
exit /b 0

:nochrome
echo No encuentro Google Chrome. Instalarlo o abrir a mano http://localhost:4173
goto :error

:error
pause
exit /b 1
