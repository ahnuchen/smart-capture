// 打开所在文件夹并选中文件。
// shell.showItemInFolder 在部分 Windows 场景只打开目录、不选中；
// explorer 又只认 /select,"路径" 这种「引号只包住路径」的写法（整个参数加引号会被它无视），
// 所以用 windowsVerbatimArguments 自己拼命令行，失败再退回 shell.showItemInFolder。
const { shell } = require('electron');
const { spawn } = require('child_process');

function revealFileInFolder(file) {
  if (process.platform !== 'win32') {
    shell.showItemInFolder(file);
    return;
  }
  try {
    const child = spawn('explorer.exe', ['/select,"' + file + '"'], {
      windowsVerbatimArguments: true,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => shell.showItemInFolder(file));
    child.unref();
  } catch (_) {
    shell.showItemInFolder(file);
  }
}

module.exports = { revealFileInFolder };