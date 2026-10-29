'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

/**
 * Windows GUI helpers via PowerShell + .NET. No native npm deps.
 * On non-Windows hosts the tools refuse so unit tests stay portable.
 */

const SCREEN_CAPTURE_PS = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$bmp.Save($env:AGENT_SHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ('{"width":' + $bounds.Width + ',"height":' + $bounds.Height + '}')
`.trim();

const UIA_MARKS_PS = "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing,System.Windows.Forms\n$ErrorActionPreference = 'Stop'\n$outPath = $env:AGENT_SHOT_PATH\n$metaPath = $env:AGENT_MARKS_PATH\n$max = [Math]::Max(1, [int]($env:AGENT_MAX_ELEMENTS))\n$hwndRaw = $env:AGENT_HWND\n\n$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen\n$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height\n$g = [System.Drawing.Graphics]::FromImage($bmp)\n$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)\n\nfunction Get-RootElement {\n  if ($hwndRaw) {\n    $h = [IntPtr][int64]$hwndRaw\n    return [System.Windows.Automation.AutomationElement]::FromHandle($h)\n  }\n  $fg = [System.Windows.Automation.AutomationElement]::FocusedElement\n  if ($fg) { return $fg }\n  return [System.Windows.Automation.AutomationElement]::RootElement\n}\n\n$wanted = @(\n  [System.Windows.Automation.ControlType]::Button,\n  [System.Windows.Automation.ControlType]::Edit,\n  [System.Windows.Automation.ControlType]::CheckBox,\n  [System.Windows.Automation.ControlType]::RadioButton,\n  [System.Windows.Automation.ControlType]::ComboBox,\n  [System.Windows.Automation.ControlType]::Hyperlink,\n  [System.Windows.Automation.ControlType]::ListItem,\n  [System.Windows.Automation.ControlType]::MenuItem,\n  [System.Windows.Automation.ControlType]::TabItem,\n  [System.Windows.Automation.ControlType]::TreeItem,\n  [System.Windows.Automation.ControlType]::DataItem,\n  [System.Windows.Automation.ControlType]::SplitButton,\n  [System.Windows.Automation.ControlType]::Slider,\n  [System.Windows.Automation.ControlType]::Thumb\n)\n\n$root = Get-RootElement\n$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker\n$elements = New-Object System.Collections.Generic.List[object]\n$stack = New-Object System.Collections.Generic.Stack[object]\n$stack.Push($root)\n$seen = 0\nwhile ($stack.Count -gt 0 -and $elements.Count -lt $max) {\n  $el = $stack.Pop()\n  $seen++\n  if ($seen -gt 4000) { break }\n  try {\n    $rect = $el.Current.BoundingRectangle\n    if ($rect.Width -ge 8 -and $rect.Height -ge 8 -and $rect.Width -lt ($screen.Width + 2) -and $rect.Height -lt ($screen.Height + 2)) {\n      $sx = [int]($rect.X - $screen.X)\n      $sy = [int]($rect.Y - $screen.Y)\n      if ($sx -lt $screen.Width -and $sy -lt $screen.Height -and ($sx + $rect.Width) -gt 0 -and ($sy + $rect.Height) -gt 0) {\n        $ct = $el.Current.ControlType\n        $clickable = $false\n        foreach ($w in $wanted) { if ($ct -eq $w) { $clickable = $true; break } }\n        if (-not $clickable) {\n          try { if ($el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { $clickable = $true } } catch {}\n          try { if ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $clickable = $true } } catch {}\n        }\n        if ($clickable) {\n          $name = [string]$el.Current.Name\n          if ($name.Length -gt 80) { $name = $name.Substring(0, 80) }\n          $elements.Add([pscustomobject]@{\n            id = $elements.Count + 1\n            name = $name\n            type = $ct.ProgrammaticName\n            x = $sx\n            y = $sy\n            width = [int]$rect.Width\n            height = [int]$rect.Height\n            cx = [int]($sx + $rect.Width / 2)\n            cy = [int]($sy + $rect.Height / 2)\n          })\n        }\n      }\n    }\n  } catch {}\n  try {\n    $child = $walker.GetFirstChild($el)\n    while ($null -ne $child) {\n      $stack.Push($child)\n      $child = $walker.GetNextSibling($child)\n    }\n  } catch {}\n}\n\n$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 255, 60, 60)), 2\n$font = New-Object System.Drawing.Font 'Segoe UI', 11, ([System.Drawing.FontStyle]::Bold)\n$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 220, 40, 40))\n$textBrush = [System.Drawing.Brushes]::White\nforeach ($item in $elements) {\n  $g.DrawRectangle($pen, $item.x, $item.y, $item.width, $item.height)\n  $label = [string]$item.id\n  $size = $g.MeasureString($label, $font)\n  $lx = [Math]::Max(0, $item.x)\n  $ly = [Math]::Max(0, $item.y - [int]$size.Height - 2)\n  $g.FillRectangle($bgBrush, $lx, $ly, [int]$size.Width + 4, [int]$size.Height + 2)\n  $g.DrawString($label, $font, $textBrush, $lx + 2, $ly)\n}\n$g.Dispose()\n$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)\n$bmp.Dispose()\n$pen.Dispose(); $font.Dispose(); $bgBrush.Dispose()\n\n$json = ($elements | ConvertTo-Json -Compress -Depth 4)\nif (-not $json) { $json = '[]' }\nif ($json[0] -ne '[') { $json = '[' + $json + ']' }\n[System.IO.File]::WriteAllText($metaPath, $json, [System.Text.UTF8Encoding]::new($false))\nWrite-Output ('{\"width\":' + $screen.Width + ',\"height\":' + $screen.Height + ',\"count\":' + $elements.Count + '}')";

const INPUT_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AgentInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
$action = $env:AGENT_INPUT_ACTION
switch ($action) {
  'move' { [AgentInput]::SetCursorPos([int]$env:AGENT_X, [int]$env:AGENT_Y) | Out-Null; Write-Output 'ok' }
  'click' {
    if ($env:AGENT_X -and $env:AGENT_Y) { [AgentInput]::SetCursorPos([int]$env:AGENT_X, [int]$env:AGENT_Y) | Out-Null }
    $btn = $env:AGENT_BUTTON
    $down = if ($btn -eq 'right') { [AgentInput]::MOUSEEVENTF_RIGHTDOWN } elseif ($btn -eq 'middle') { [AgentInput]::MOUSEEVENTF_MIDDLEDOWN } else { [AgentInput]::MOUSEEVENTF_LEFTDOWN }
    $up = if ($btn -eq 'right') { [AgentInput]::MOUSEEVENTF_RIGHTUP } elseif ($btn -eq 'middle') { [AgentInput]::MOUSEEVENTF_MIDDLEUP } else { [AgentInput]::MOUSEEVENTF_LEFTUP }
    $times = [Math]::Max(1, [int]$env:AGENT_CLICKS)
    for ($i = 0; $i -lt $times; $i++) {
      [AgentInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 40
      [AgentInput]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
      if ($i -lt $times - 1) { Start-Sleep -Milliseconds 80 }
    }
    Write-Output 'ok'
  }
  'drag' {
    [AgentInput]::SetCursorPos([int]$env:AGENT_X, [int]$env:AGENT_Y) | Out-Null
    [AgentInput]::mouse_event([AgentInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [AgentInput]::SetCursorPos([int]$env:AGENT_X2, [int]$env:AGENT_Y2) | Out-Null
    Start-Sleep -Milliseconds 40
    [AgentInput]::mouse_event([AgentInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    Write-Output 'ok'
  }
  'scroll' {
    if ($env:AGENT_X -and $env:AGENT_Y) { [AgentInput]::SetCursorPos([int]$env:AGENT_X, [int]$env:AGENT_Y) | Out-Null }
    $delta = [int]$env:AGENT_DELTA
    [AgentInput]::mouse_event([AgentInput]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]$delta, [UIntPtr]::Zero)
    Write-Output 'ok'
  }
  'type' {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($env:AGENT_TEXT)
    Write-Output 'ok'
  }
  'hotkey' {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($env:AGENT_TEXT)
    Write-Output 'ok'
  }
  'list_windows' {
    $list = New-Object System.Collections.Generic.List[string]
    $cb = [AgentInput+EnumWindowsProc]{
      param($h,$l)
      if (-not [AgentInput]::IsWindowVisible($h)) { return $true }
      $sb = New-Object System.Text.StringBuilder 512
      [void][AgentInput]::GetWindowText($h, $sb, $sb.Capacity)
      $title = $sb.ToString()
      if ([string]::IsNullOrWhiteSpace($title)) { return $true }
      $pid = 0
      [void][AgentInput]::GetWindowThreadProcessId($h, [ref]$pid)
      $jsonTitle = ($title | ConvertTo-Json -Compress); $list.Add(('{"hwnd":' + [int64]$h + ',"pid":' + $pid + ',"title":' + $jsonTitle + '}'))
      return $true
    }
    [AgentInput]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    Write-Output ("[" + ($list -join ',') + "]")
  }
  'focus_window' {
    $h = [IntPtr][int64]$env:AGENT_HWND
    [AgentInput]::ShowWindow($h, 9) | Out-Null
    [AgentInput]::SetForegroundWindow($h) | Out-Null
    Write-Output 'ok'
  }
  default { throw "unknown action $action" }
}
`.trim();

function assertWindows(platform = process.platform) {
  if (platform !== 'win32') throw new Error('电脑界面控制仅支持 Windows');
}

function runPowerShell(script, { env = {}, timeoutMs = 30_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      cwd,
      windowsHide: true,
      env: { ...process.env, ...env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error((stderr || stdout || `PowerShell 退出码 ${code}`).trim().slice(0, 800)));
      else resolve(stdout.trim());
    });
  });
}

function escapeSendKeys(text) {
  return String(text ?? '').replace(/([+^%~(){}\[\]])/g, '{$1}');
}

function hotkeyToSendKeys(keys) {
  const parts = String(keys || '').split(/[+\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('快捷键为空');
  const map = {
    ctrl: '^', control: '^', alt: '%', shift: '+', win: '^{ESC}',
    enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}',
    backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    home: '{HOME}', end: '{END}', pgup: '{PGUP}', pgdn: '{PGDN}',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
    f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
    space: ' '
  };
  let mods = '';
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (map[lower] && !key && ['ctrl', 'control', 'alt', 'shift', 'win'].includes(lower)) mods += map[lower] === '^{ESC}' ? '' : map[lower];
    else if (map[lower]) key = map[lower];
    else key = escapeSendKeys(part);
  }
  if (!key) throw new Error('快捷键缺少主键');
  return mods + key;
}

function createComputer({ platform = process.platform, mediaDir, runPs = runPowerShell } = {}) {
  async function screenshot({ max_side = 1600 } = {}) {
    assertWindows(platform);
    const dir = mediaDir || await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-shot-'));
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `shot-${Date.now()}.png`);
    const raw = await runPs(SCREEN_CAPTURE_PS, { env: { AGENT_SHOT_PATH: file }, timeoutMs: 20_000 });
    let meta = {};
    try { meta = JSON.parse(raw); } catch (_err) { meta = {}; }
    const bytes = await fsp.readFile(file);
    const side = Math.min(Math.max(Number(max_side) || 1600, 320), 2400);
    return {
      path: file,
      bytes: bytes.length,
      width: meta.width || 0,
      height: meta.height || 0,
      mime: 'image/png',
      base64: bytes.toString('base64'),
      note: side < (meta.width || side) ? `原图已保存；模型侧建议按最长边约 ${side}px 理解` : '截屏成功'
    };
  }

  async function input(action, fields = {}) {
    assertWindows(platform);
    const env = {
      AGENT_INPUT_ACTION: action,
      AGENT_X: fields.x == null ? '' : String(Math.round(Number(fields.x))),
      AGENT_Y: fields.y == null ? '' : String(Math.round(Number(fields.y))),
      AGENT_X2: fields.x2 == null ? '' : String(Math.round(Number(fields.x2))),
      AGENT_Y2: fields.y2 == null ? '' : String(Math.round(Number(fields.y2))),
      AGENT_BUTTON: String(fields.button || 'left'),
      AGENT_CLICKS: String(fields.clicks || 1),
      AGENT_DELTA: String(fields.delta || 0),
      AGENT_TEXT: String(fields.text || ''),
      AGENT_HWND: String(fields.hwnd || '')
    };
    const out = await runPs(INPUT_PS, { env, timeoutMs: 20_000 });
    if (action === 'list_windows') {
      try { return { windows: JSON.parse(out || '[]').slice(0, 80) }; } catch (_err) { return { windows: [], raw: out.slice(0, 2000) }; }
    }
    return { ok: true, action };
  }

  let lastMarks = [];

  async function screenshot_marked({ hwnd, max_elements = 80 } = {}) {
    assertWindows(platform);
    const dir = mediaDir || await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-shot-'));
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `marked-${Date.now()}.png`);
    const metaFile = path.join(dir, `marked-${Date.now()}.json`);
    const raw = await runPs(UIA_MARKS_PS, {
      env: {
        AGENT_SHOT_PATH: file,
        AGENT_MARKS_PATH: metaFile,
        AGENT_MAX_ELEMENTS: String(Math.min(Math.max(Number(max_elements) || 80, 1), 200)),
        AGENT_HWND: hwnd == null || hwnd === '' ? '' : String(hwnd)
      },
      timeoutMs: 45_000
    });
    let meta = {};
    try { meta = JSON.parse(raw); } catch (_err) { meta = {}; }
    let elements = [];
    try { elements = JSON.parse(await fsp.readFile(metaFile, 'utf8')); } catch (_err) { elements = []; }
    if (!Array.isArray(elements)) elements = [];
    lastMarks = elements;
    const bytes = await fsp.readFile(file);
    return {
      path: file,
      bytes: bytes.length,
      width: meta.width || 0,
      height: meta.height || 0,
      mime: 'image/png',
      base64: bytes.toString('base64'),
      elements,
      count: elements.length,
      note: '红框编号为可点击/可输入控件；请用 ui_click / ui_type 按 id 操作'
    };
  }

  function markById(id) {
    const item = lastMarks.find(entry => Number(entry.id) === Number(id));
    if (!item) throw new Error(`找不到元素 #${id}，请先调用 screenshot_marked`);
    return item;
  }

  async function ui_click({ id, button = 'left', clicks = 1 } = {}) {
    const item = markById(id);
    return input('click', { x: item.cx, y: item.cy, button, clicks });
  }

  async function ui_type({ id, text = '', submit = false } = {}) {
    const item = markById(id);
    await input('click', { x: item.cx, y: item.cy, button: 'left', clicks: 1 });
    await input('type', { text: escapeSendKeys(String(text ?? '')) });
    if (submit) await input('hotkey', { text: '{ENTER}' });
    return { ok: true, id: Number(id), typed: String(text ?? '').length };
  }

  function list_ui_elements() {
    return { elements: lastMarks.slice(), count: lastMarks.length };
  }

  return {
    screenshot,
    screenshot_marked,
    list_ui_elements,
    ui_click,
    ui_type,
    mouse_move: ({ x, y }) => input('move', { x, y }),
    mouse_click: ({ x, y, button = 'left', clicks = 1 } = {}) => input('click', { x, y, button, clicks }),
    mouse_drag: ({ x, y, x2, y2 }) => input('drag', { x, y, x2, y2 }),
    mouse_scroll: ({ x, y, delta = -120 } = {}) => input('scroll', { x, y, delta }),
    keyboard_type: ({ text = '', literal = true } = {}) => input('type', { text: literal ? escapeSendKeys(text) : String(text) }),
    keyboard_hotkey: ({ keys = '' } = {}) => input('hotkey', { text: hotkeyToSendKeys(keys) }),
    list_windows: () => input('list_windows'),
    focus_window: ({ hwnd }) => input('focus_window', { hwnd }),
    escapeSendKeys,
    hotkeyToSendKeys,
    runPowerShell: runPs,
    getLastMarks: () => lastMarks.slice()
  };
}

module.exports = {
  createComputer,
  escapeSendKeys,
  hotkeyToSendKeys,
  runPowerShell,
  SCREEN_CAPTURE_PS,
  INPUT_PS,
  UIA_MARKS_PS
};
