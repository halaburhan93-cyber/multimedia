/* =========================================================
   أدوات الترميز (Encoders)
   - encodeWAV: يحوّل بيانات الصوت الخام إلى ملف WAV حقيقي (PCM 16-bit)
   - encodeBMP: يحوّل بكسلات الصورة إلى ملف BMP حقيقي (24-bit)
   هذه الدوال لا تعتمد على الإنترنت، وتعمل داخل المتصفح بالكامل.
   ========================================================= */
(function (global) {
  "use strict";

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  /**
   * @param {Float32Array[]} channels  قناة لكل عنصر (قيم بين -1 و 1)
   * @param {number} sampleRate        معدل العيّنات مثل 44100
   * @returns {Blob} ملف audio/wav
   */
  function encodeWAV(channels, sampleRate) {
    const numChannels = channels.length;
    const length = channels[0].length;
    const bytesPerSample = 2;
    const dataSize = length * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buffer);

    // ترويسة RIFF/WAVE
    writeString(v, 0, "RIFF");
    v.setUint32(4, 36 + dataSize, true);
    writeString(v, 8, "WAVE");
    // مقطع fmt
    writeString(v, 12, "fmt ");
    v.setUint32(16, 16, true);                                   // حجم المقطع
    v.setUint16(20, 1, true);                                    // PCM
    v.setUint16(22, numChannels, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
    v.setUint16(32, numChannels * bytesPerSample, true);         // block align
    v.setUint16(34, 16, true);                                   // bits per sample
    // مقطع data
    writeString(v, 36, "data");
    v.setUint32(40, dataSize, true);

    // البيانات (القنوات متداخلة: يسار، يمين، يسار، يمين…)
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = channels[c][i];
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  /**
   * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
   * @returns {Blob} ملف image/bmp
   */
  function encodeBMP(imageData) {
    const { width, height, data } = imageData;
    const rowSize = Math.ceil((width * 3) / 4) * 4; // كل صف مبطّن إلى مضاعفات 4
    const pixelSize = rowSize * height;
    const fileSize = 54 + pixelSize;
    const buffer = new ArrayBuffer(fileSize);
    const v = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // ترويسة الملف
    v.setUint8(0, 0x42); v.setUint8(1, 0x4d);   // "BM"
    v.setUint32(2, fileSize, true);
    v.setUint32(10, 54, true);                  // بداية البكسلات
    // ترويسة المعلومات (BITMAPINFOHEADER)
    v.setUint32(14, 40, true);
    v.setInt32(18, width, true);
    v.setInt32(22, height, true);
    v.setUint16(26, 1, true);                   // planes
    v.setUint16(28, 24, true);                  // 24-bit
    v.setUint32(30, 0, true);                   // بدون ضغط
    v.setUint32(34, pixelSize, true);
    v.setInt32(38, 2835, true);                 // 72 DPI
    v.setInt32(42, 2835, true);

    // BMP يُخزَّن من الأسفل إلى الأعلى وبترتيب BGR
    for (let y = 0; y < height; y++) {
      const rowStart = 54 + (height - 1 - y) * rowSize;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const o = rowStart + x * 3;
        bytes[o] = data[i + 2];
        bytes[o + 1] = data[i + 1];
        bytes[o + 2] = data[i];
      }
    }
    return new Blob([buffer], { type: "image/bmp" });
  }

  global.Encoders = { encodeWAV, encodeBMP };
})(typeof window !== "undefined" ? window : globalThis);
