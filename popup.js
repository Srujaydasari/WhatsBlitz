document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('dropZone');
  const csvFile = document.getElementById('csvFile');
  const startBtn = document.getElementById('startBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const status = document.getElementById('status');
  const fileNameDisplay = document.getElementById('fileName');
  const clearFileBtn = document.getElementById('clearFileBtn');
  const logOutput = document.getElementById('logOutput');
  const downloadLogBtn = document.getElementById('downloadLogBtn');

  const invalidNumberModal = document.getElementById('invalidNumberModal');
  const stopProcessBtn = document.getElementById('stopProcessBtn');
  const continueSendBtn = document.getElementById('continueSendBtn');
  const modalOverlay = document.getElementById('modalOverlay');

  let messageData = [];
  let isProcessing = false;
  let isCancelled = false;
  let messageLog = [];

  dropZone.addEventListener('click', () => {
    if (!isProcessing) csvFile.click();
  });
  dropZone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) {
      e.preventDefault();
      csvFile.click();
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.backgroundColor = '#f0f0f0';
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.backgroundColor = '';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.backgroundColor = '';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  csvFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  });

  clearFileBtn.addEventListener('click', () => {
    if (!isProcessing) resetFileInput();
  });

  downloadLogBtn.addEventListener('click', () => {
    if (messageLog.length === 0) {
      alert('No logs to download.');
      return;
    }

    const headers = ['Phone Number', 'Message', 'Status'];
    const csvRows = [
      headers.join(','),
      ...messageLog.map(log =>
        `"${log.phone}","${log.message.replace(/"/g, '""')}","${log.status.replace(/"/g, '""')}"`
      )
    ];

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'message_log.csv';
    a.click();

    URL.revokeObjectURL(url);
  });

  function resetFileInput() {
    csvFile.value = '';
    messageData = [];
    messageLog = [];  // clear log on reset
    startBtn.disabled = true;
    startBtn.setAttribute('aria-disabled', 'true');
    fileNameDisplay.textContent = 'Drop or select your CSV or Excel file';
    clearFileBtn.hidden = true;
    logOutput.textContent = '';
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
    status.textContent = '';
  }

  function handleFile(file) {
    const reader = new FileReader();
    const fileName = file.name.toLowerCase();

    reader.onload = (e) => {
      try {
        let workbook;
        if (fileName.endsWith('.csv')) {
          workbook = XLSX.read(e.target.result, { type: 'binary', codepage: 65001 });
        } else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
          workbook = XLSX.read(e.target.result, { type: 'binary' });
        } else {
          alert('Unsupported file format. Please select CSV, XLS, or XLSX.');
          resetFileInput();
          return;
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!json || json.length === 0) {
          alert('File is empty or invalid.');
          resetFileInput();
          return;
        }

        processData(json);
        fileNameDisplay.textContent = file.name;
        clearFileBtn.hidden = false;
      } catch (error) {
        alert('Error processing file: ' + error.message);
        resetFileInput();
      }
    };

    reader.onerror = () => {
      alert('Could not read the file.');
      resetFileInput();
    };

    reader.readAsBinaryString(file);
  }

  function processData(data) {
    const requiredCols = ['phone number', 'message'];
    const keys = Object.keys(data[0]).map(k => k.toLowerCase().trim());

    for (const col of requiredCols) {
      if (!keys.includes(col)) {
        alert(`Missing required column: "${col}"`);
        resetFileInput();
        return;
      }
    }

    messageData = data.map(row => {
      const normalized = {};
      for (const key in row) {
        normalized[key.toLowerCase().trim()] = String(row[key]).trim();
      }
      return normalized;
    }).filter(entry => {
      const phone = entry['phone number'].replace(/[^0-9]/g, '');
      const message = entry['message'];
      return phone && message;
    });

    if (messageData.length === 0) {
      alert('No valid messages found.');
      resetFileInput();
      return;
    }

    startBtn.disabled = false;
    startBtn.setAttribute('aria-disabled', 'false');
    logOutput.textContent = `Loaded ${messageData.length} messages. Ready to start.`;
  }

  function replacePlaceholders(message, data) {
    return message.replace(/\{(\w+)\}/g, (_, key) => data[key.toLowerCase()] || '');
  }

  function showInvalidNumberModal() {
    return new Promise((resolve) => {
      invalidNumberModal.style.display = 'block';
      modalOverlay.style.display = 'block';

      function cleanup() {
        invalidNumberModal.style.display = 'none';
        modalOverlay.style.display = 'none';
        stopProcessBtn.removeEventListener('click', onStop);
        continueSendBtn.removeEventListener('click', onContinue);
      }

      function onStop() {
        cleanup();
        resolve('stop');
      }

      function onContinue() {
        cleanup();
        resolve('continue');
      }

      stopProcessBtn.addEventListener('click', onStop);
      continueSendBtn.addEventListener('click', onContinue);
    });
  }

  startBtn.addEventListener('click', async () => {
    if (messageData.length === 0 || isProcessing) return;

    let tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    let whatsappTab;

    if (tabs.length === 0) {
      whatsappTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      alert('WhatsApp Web opened. Please scan QR code and click Start again after login.');
      return;
    } else {
      whatsappTab = tabs[0];
      chrome.tabs.update(whatsappTab.id, { active: true });
    }

    isProcessing = true;
    isCancelled = false;
    startBtn.disabled = true;
    startBtn.setAttribute('aria-disabled', 'true');
    cancelBtn.style.display = 'inline-block';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    logOutput.textContent = '';
    messageLog = [];  // clear logs on new run

    let processed = 0, success = 0, failed = 0, errors = [];

    for (const entry of messageData) {
      if (!isProcessing || isCancelled) break;

      const phone = entry['phone number'].replace(/[^0-9]/g, '');
      let message = entry['message'];

      let statusText = '';
      if (!/^\d{10,15}$/.test(phone)) {
        logOutput.textContent += `Invalid phone number: ${phone}\n`;
        failed++;
        errors.push(`Invalid number: ${phone}`);

        messageLog.push({ phone, message, status: 'Invalid phone number' });

        const userChoice = await showInvalidNumberModal();

        if (userChoice === 'stop') {
          isCancelled = true;
          break;
        } else {
          processed++;
          continue;
        }
      }

      message = replacePlaceholders(message, entry);

      status.textContent = `Sending ${processed + 1} of ${messageData.length}`;
      logOutput.textContent += `Sending to ${phone}: ${message}\n`;
      logOutput.scrollTop = logOutput.scrollHeight;

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'sendWhatsAppMessage',
          data: { phone, message }
        });

        if (response?.success) {
          success++;
          statusText = 'Success';
        } else {
          failed++;
          const errorMsg = response?.error || 'Unknown error';
          errors.push(`Failed for ${phone}: ${errorMsg}`);
          alert(`Send failed for ${phone}: ${errorMsg}`);
          statusText = `Failed: ${errorMsg}`;
        }
      } catch (err) {
        failed++;
        errors.push(`Error for ${phone}: ${err.message}`);
        alert(`Send error for ${phone}: ${err.message}`);
        statusText = `Error: ${err.message}`;
      }

      messageLog.push({ phone, message, status: statusText });

      processed++;
      progressBar.style.width = `${(processed / messageData.length) * 100}%`;
      status.textContent = `Progress: ${processed}/${messageData.length} — Success: ${success}, Failed: ${failed}`;

      const randomDelay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
      await new Promise(r => setTimeout(r, randomDelay));
    }

    if (isCancelled) {
      logOutput.textContent += '\nSending cancelled by user.\n';
      status.textContent = 'Cancelled.';
    } else {
      logOutput.textContent += `\nCompleted.\nSuccess: ${success}, Failed: ${failed}\n`;
      if (errors.length) logOutput.textContent += `Errors:\n${errors.join('\n')}`;
      status.textContent = 'All messages processed.';
    }

    isProcessing = false;
    cancelBtn.style.display = 'none';
    startBtn.disabled = false;
    startBtn.setAttribute('aria-disabled', 'false');
  });

  cancelBtn.addEventListener('click', () => {
    if (isProcessing) {
      isCancelled = true;
      isProcessing = false;
      cancelBtn.style.display = 'none';
      chrome.runtime.sendMessage({ action: 'cancelSending' });
      logOutput.textContent += '\nProcess cancelled by user.\n';
      status.textContent = 'Cancelled.';
    }
  });

  resetFileInput();
});
