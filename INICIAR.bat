@echo off
setlocal
chcp 65001 >nul
title PotyPet
cd /d "%~dp0"
if not exist server.js goto :incomplete
if not exist package.json goto :incomplete
if not exist package-lock.json goto :incomplete
if not exist index.html goto :incomplete
if not exist js\store.js goto :incomplete
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado.
  echo Instale o Node.js 24.21.0 LTS, da linha 24, e tente novamente.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]!==24||v[1]<21){console.error('Use Node.js 24.21.0 LTS ou atualizacao posterior da linha 24.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
node -e "const fs=require('node:fs'),path=require('node:path');for(const [name,version] of Object.entries(require('./package.json').dependencies)){if(JSON.parse(fs.readFileSync(path.join('node_modules',name,'package.json'),'utf8')).version!==version)process.exit(1);require(name)}" >nul 2>nul
if errorlevel 1 (
  echo Instalando dependencias. A primeira instalacao precisa de internet.
  call npm ci
  if errorlevel 1 (
    echo Nao foi possivel instalar as dependencias. Confira o erro acima e sua conexao.
    pause
    exit /b 1
  )
)
echo Iniciando PotyPet...
echo Abra http://127.0.0.1:3000 no navegador.
echo.
node server.js
pause
exit /b 0

:incomplete
echo.
echo A pasta do projeto esta incompleta.
echo Nao abra INICIAR.bat diretamente dentro do ZIP ou WinRAR.
echo Use "Extrair para..." para extrair TODO o ZIP em uma pasta.
echo Depois abra essa pasta e execute INICIAR.bat novamente.
echo Mantenha server.js, package.json e package-lock.json junto deste arquivo.
echo.
pause
exit /b 1
