let isCancelled = false;

function isValidPhoneNumber(phone) {
  // Basic validation: phone number must be digits only and at least 8 digits (adjust as needed)
  const cleaned = phone.replace(/[^0-9]/g, '');
  return cleaned.length >= 8 && /^[0-9]+$/.test(cleaned);
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return true;
  } catch (error) {
    console.error('Error injecting content script:', error);
    return false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendWhatsAppMessage') {
    isCancelled = false;
    handleWhatsAppMessage(request.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  }

  if (request.action === 'cancelSending') {
    console.log('Cancelling message sending...');
    isCancelled = true;
    sendResponse({ success: true });
  }
});

async function handleWhatsAppMessage(data) {
  let { phone, message } = data;
  const formattedPhone = phone.replace(/[^0-9]/g, '');

  if (!isValidPhoneNumber(formattedPhone)) {
    console.warn(`Invalid phone number detected: ${phone}`);
    return { success: false, error: 'Invalid phone number, skipped sending.' };
  }

  const url = `https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;

  try {
    if (isCancelled) return { success: false, error: 'Process cancelled before starting.' };

    // Find WhatsApp Web tab or open new one
    let [whatsappTab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });

    if (!whatsappTab) {
      whatsappTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      await delayWithCancel(15000); // Wait for WhatsApp to load
    }

    if (isCancelled) return { success: false, error: 'Process cancelled before opening chat.' };

    // Update tab URL to open specific chat
    await chrome.tabs.update(whatsappTab.id, { url });

    // Focus the WhatsApp tab
    await chrome.tabs.update(whatsappTab.id, { active: true });

    await delayWithCancel(10000); // Wait for chat to load

    if (isCancelled) return { success: false, error: 'Process cancelled before injecting script.' };

    const injected = await injectContentScript(whatsappTab.id);
    if (!injected) throw new Error('Failed to inject content script');

    if (isCancelled) return { success: false, error: 'Process cancelled before sending message.' };

    const response = await sendMessageToTab(whatsappTab.id, {
      action: 'sendMessage',
      data: { phone: formattedPhone, message }
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Unknown content script error');
    }

    return { success: true };
  } catch (err) {
    if (err.message === 'Cancelled') {
      // Cancellation is expected - log as info, not error
      console.log('handleWhatsAppMessage was cancelled by user.');
    } else if (err.message !== 'Number is wrong, please verify.') {
      // Log unexpected errors only
      console.error('handleWhatsAppMessage error:', err);
    }

    return { success: false, error: err.message };
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

function delayWithCancel(ms) {
  return new Promise((resolve, reject) => {
    const interval = 100;
    let elapsed = 0;

    function check() {
      if (isCancelled) {
        reject(new Error('Cancelled'));
        return;
      }
      if (elapsed >= ms) {
        resolve();
      } else {
        elapsed += interval;
        setTimeout(check, interval);
      }
    }

    check();
  });
}
