// tests/live-desktop-test.js
// Live test: type_text + press_key di Notepad
// Jalanin: node tests/live-desktop-test.js
// HANYA untuk Windows (real PowerShell)

const tools = await import('../src/tooling/desktopTools.js');
const cp = await import('node:child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Live Test: type_text + press_key di Notepad ===\n');
  console.log('Platform:', process.platform);

  if (process.platform !== 'win32') {
    console.log('❌ Test ini hanya untuk Windows.');
    process.exit(1);
  }

  // Step 1: Launch Notepad
  console.log('\n1️⃣ Launching Notepad...');
  const launchResult = await tools.launchAppTool.execute({ target: 'notepad.exe' });
  console.log('   Result:', launchResult);

  // Extract PID
  const pidMatch = launchResult.match(/PID:\s*(\d+)/);
  const pid = pidMatch ? pidMatch[1] : 'unknown';
  console.log('   PID:', pid);

  // Step 2: Wait for Notepad to open
  console.log('\n2️⃣ Waiting for Notepad to open...');
  await sleep(1500);

  // Step 3: List windows to confirm Notepad is running
  console.log('\n3️⃣ Confirming Notepad window...');
  const windowsBefore = await tools.listWindowsTool.execute({ filter: 'notepad' });
  console.log('   Windows found:', windowsBefore.includes('Notepad') ? '✅' : '❌');

  // Step 4: Type some text
  console.log('\n4️⃣ Typing text...');
  const text1 = 'Halo Nythros! Desktop automation works!';
  const typeResult1 = await tools.typeTextTool.execute({ text: text1, delay_ms: 5 });
  console.log('   Result:', typeResult1);
  await sleep(300);

  // Step 5: Press Enter twice
  console.log('\n5️⃣ Pressing Enter (x2)...');
  const enterResult = await tools.pressKeyTool.execute({ key: 'enter' });
  console.log('   Enter 1:', enterResult);
  await sleep(100);

  await tools.pressKeyTool.execute({ key: 'enter' });
  console.log('   Enter 2: ✅');
  await sleep(200);

  // Step 6: Type more text
  console.log('\n6️⃣ Typing more text...');
  const text2 = 'Special chars: + ^ % ~ { } ( ) [ ] — semua harus diketik literal!';
  const typeResult2 = await tools.typeTextTool.execute({ text: text2, delay_ms: 5 });
  console.log('   Result:', typeResult2);
  await sleep(300);

  // Step 7: Press Tab then type again
  console.log('\n7️⃣ Tab + more text...');
  await tools.pressKeyTool.execute({ key: 'tab' });
  await sleep(100);
  await tools.typeTextTool.execute({ text: 'After tab...', delay_ms: 5 });
  await sleep(300);

  // Step 8: Type numbers with newlines
  console.log('\n8️⃣ Typing numbers (newlines + tab)...');
  for (let i = 1; i <= 3; i++) {
    await tools.typeTextTool.execute({ text: `Line ${i}: testing desktop tools`, delay_ms: 2 });
    await sleep(100);
    await tools.pressKeyTool.execute({ key: 'enter' });
    await sleep(50);
  }

  // Step 9: Take screenshot
  console.log('\n9️⃣ Taking screenshot...');
  const screenshot = await tools.screenshotTool.execute({});
  console.log('   Screenshot saved!');
  console.log('   Result:', screenshot);

  // Step 10: Get cursor position (final)
  console.log('\n🔟 Final cursor position...');
  const cursorPos = await tools.getCursorPosTool.execute({});
  console.log('   Result:', cursorPos);

  // Step 11: Cleanup - close Notepad
  console.log('\n🧹 Cleaning up...');
  try {
    if (pid !== 'unknown') {
      cp.execSync(`taskkill /pid ${pid} /f 2>nul`, { stdio: 'ignore' });
      console.log(`   Notepad (PID ${pid}) closed. ✅`);
    } else {
      cp.execSync('taskkill /f /im notepad.exe 2>nul', { stdio: 'ignore' });
      console.log('   Notepad closed (all instances). ✅');
    }
  } catch (e) {
    console.log('   Cleanup warning:', e.message);
  }

  console.log('\n=== Test Complete ✅ ===');
}

main().catch((e) => {
  console.error('\n❌ Error:', e.message);
  // Cleanup on error
  try {
    cp.execSync('taskkill /f /im notepad.exe 2>nul', { stdio: 'ignore' });
  } catch {}
  process.exit(1);
});
