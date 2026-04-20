/**
 * OCR Processing Module
 * Supports dynamic switching between OCR.space and RoboFlow providers.
 */

// Global Configuration
// Can be customized dynamically from main scripts via window.OCR_CONFIG
window.OCR_CONFIG = window.OCR_CONFIG || {
  provider: 'ocr.space', // 'roboflow' or 'ocr.space'
  roboflow: {
    modelUrl: 'https://detect.roboflow.com/YOUR_DATASET_ID/YOUR_VERSION_ID', // Replace with your model endpoint
    apiKey: 'YOUR_ROBOFLOW_API_KEY'
  },
  ocrSpace: {
    apiKey: 'helloworld', // Replace with your OCR.space API key
    language: 'eng'
  }
};

/**
 * Unified OCR handler function
 * Routes requests based on selected provider
 * 
 * @param {File|Blob|string} image - Image file object, Blob, or Data URL base64 string
 * @returns {Promise<{success: boolean, extractedNumber: string|null, rawText: string, providerUsed: string}>}
 */
async function processOCR(image) {
  try {
    const configRes = await fetch('/ocr-provider');
    if (configRes.ok) {
      const serverConfig = await configRes.json();
      if (serverConfig.activeProvider) {
        window.OCR_CONFIG.provider = serverConfig.activeProvider;
      }
    }
  } catch (err) {
    console.warn("Could not fetch remote OCR config, falling back to local.", err);
  }

  const provider = window.OCR_CONFIG?.provider || 'ocr.space';
  
  try {
    if (provider === 'roboflow') {
      return await processRoboFlow(image);
    } else if (provider === 'ocr.space') {
      return await processOCRSpace(image);
    } else {
      throw new Error(`Unsupported OCR provider: ${provider}`);
    }
  } catch (error) {
    console.error("[processOCR] Error:", error);
    return {
      success: false,
      extractedNumber: null,
      rawText: error.message || "Unknown error occurred",
      providerUsed: provider
    };
  }
}

/**
 * OCR.space API Integration
 */
async function processOCRSpace(image) {
  const config = window.OCR_CONFIG.ocrSpace;
  const formData = new FormData();
  
  if (typeof image === 'string' && image.startsWith('http')) {
    formData.append('url', image);
  } else if (typeof image === 'string' && image.startsWith('data:image')) {
    formData.append('base64Image', image);
  } else {
    // Assuming a File or Blob
    formData.append('file', image);
  }
  
  formData.append('language', config.language || 'eng');
  formData.append('apikey', config.apiKey);
  formData.append('isOverlayRequired', 'false');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();
  
  if (data.IsErroredOnProcessing) {
    throw new Error(data.ErrorMessage ? data.ErrorMessage.join(', ') : 'OCR.space processing error');
  }

  // Extract raw text
  let rawText = '';
  if (data.ParsedResults && data.ParsedResults.length > 0) {
    rawText = data.ParsedResults[0].ParsedText || '';
  }

  // Extract number using regex from returned text
  // Matches the first sequence of digits found in the text
  const match = rawText.match(/\d+/);
  const extractedNumber = match ? match[0] : null;

  return {
    success: !!extractedNumber,
    extractedNumber: extractedNumber,
    rawText: rawText,
    providerUsed: 'ocr.space'
  };
}

/**
 * RoboFlow OCR Integration
 */
async function processRoboFlow(image) {
  const config = window.OCR_CONFIG.roboflow;
  
  let base64Image = await fileToBase64(image);
  // RoboFlow expects raw base64 strictly without data URL prefix (in body for POST)
  if (base64Image.includes('base64,')) {
    base64Image = base64Image.split('base64,')[1];
  }

  const response = await fetch(`${config.modelUrl}?api_key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: base64Image
  });

  if (!response.ok) {
    throw new Error(`RoboFlow API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Full JSON response stored as rawText for RoboFlow
  const rawText = JSON.stringify(data);
  
  let extractedNumber = null;

  // Assuming RoboFlow returns predictions where the class or text is the direct output
  if (data.predictions && data.predictions.length > 0) {
    // Combine predicted classes (or ocr_text depending on model type)
    // Some models may use OCR endpoints directly returning predicted strings
    const predictionsAssumedNumber = data.predictions
      .map(p => p.class || p.ocr_text || '')
      .join('');
      
    // Because requirement says "If provider = RoboFlow -> directly return number"
    // We treat the concatenated result as the direct numeric string
    const cleanNum = predictionsAssumedNumber.replace(/[^\d]/g, '');
    if (cleanNum.length > 0) {
      extractedNumber = cleanNum;
    }
  } else if (data.text) {
    // Some endpoints wrap top level string as `text`
    const cleanNum = data.text.replace(/[^\d]/g, '');
    if (cleanNum.length > 0) extractedNumber = cleanNum;
  }

  return {
    success: !!extractedNumber,
    extractedNumber: extractedNumber,
    rawText: rawText || "No response data",
    providerUsed: 'roboflow'
  };
}

/**
 * Utility: File object to Base64
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof file === 'string') {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}
