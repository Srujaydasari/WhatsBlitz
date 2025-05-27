chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendMessage') {
    sendWhatsAppMessage(request.data.phone, request.data.message)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        // Remove console.error to avoid yellow warning on expected errors
        sendResponse({ success: false, error: error.message || 'Unknown error' });
      });
      
    return true; // keep async sendResponse alive
  }
});

async function sendWhatsAppMessage(phone, message) {
  const waitForElement = async (selectors, timeout = 30000) => {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            observer.disconnect();
            resolve(el);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          observer.disconnect();
          reject(new Error(`Timeout waiting for element: ${selectors.join(', ')}`));
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Immediate check
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });
  };

  // Selectors that indicate a valid chat is open
  const validChatSelectors = [
    'header._1i0-u',
    'header[role="banner"]',
    'div[tabindex="-1"]',
  ];

  // Wait for valid chat header to confirm chat is open
  try {
    await waitForElement(validChatSelectors, 10000);
  } catch {
    // Instead of throwing, return error gracefully
    throw new Error('Invalid phone number or chat not opened properly');
  }

  const inputSelectors = [
    'div[data-testid="conversation-compose-box-input"]',
    'div[contenteditable="true"][role="textbox"]',
    'div.selectable-text[contenteditable="true"]',
    'footer div[contenteditable="true"]'
  ];

  const sendButtonSelectors = [
    'button span[data-icon="send"]',
    'button[aria-label="Send"]',
    'button[data-testid="compose-btn-send"]',
    'button > span[data-icon="send"]'
  ];

  // Wait for input box
  console.log('Waiting for chat input...');
  const inputBox = await waitForElement(inputSelectors);

  if (!inputBox) {
    // Return error instead of throwing
    throw new Error('Could not find message input box');
  }

  inputBox.focus();

  // Insert message text
  document.execCommand('insertText', false, message);

  // Wait a bit for React internal update
  await new Promise(r => setTimeout(r, 800));

  console.log('Looking for send button...');
  let sendButton = null;
  for (let i = 0; i < 10; i++) {
    for (const selector of sendButtonSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        sendButton = el.closest('button');
        break;
      }
    }
    if (sendButton) break;
    await new Promise(r => setTimeout(r, 500));
  }

  if (!sendButton) {
    // Instead of throwing error, reject with custom error message
    throw new Error('Number is wrong, please verify.');
  }

  console.log('Clicking send button...');
  sendButton.click();

  await new Promise(r => setTimeout(r, 2000)); // Wait to ensure sent
}
