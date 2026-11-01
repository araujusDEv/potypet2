/* Shared by animal and missing-pet forms. Only newly selected files are processed. */
const PhotoUpload = {
  get policy() {
    return App.data.photoPolicy;
  },
  status(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  },
  async process(file) {
    const limits = this.policy?.limits;
    if (!limits) throw Error('Não foi possível carregar os limites de fotos. Recarregue a página.');
    if (file.size > limits.maxOriginalBytes)
      throw Error('O arquivo original excede 20 MB. Escolha uma foto menor.');
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const format =
      header[0] === 255 && header[1] === 216
        ? 'image/jpeg'
        : header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71
          ? 'image/png'
          : String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
              String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
            ? 'image/webp'
            : '';
    if (!format || (file.type && !limits.formats.includes(file.type)))
      throw Error('Formato não suportado. Use uma foto JPG, PNG ou WebP.');
    if (file.type && file.type !== format)
      throw Error('O conteúdo da foto não corresponde ao formato informado.');
    const tail = new Uint8Array(await file.slice(-12).arrayBuffer());
    const complete =
      format === 'image/jpeg'
        ? tail[tail.length - 2] === 255 && tail[tail.length - 1] === 217
        : format === 'image/png'
          ? String.fromCharCode(...tail.slice(4, 8)) === 'IEND'
          : header.length >= 12 && new DataView(header.buffer).getUint32(4, true) + 8 === file.size;
    if (!complete) throw Error('Imagem corrompida ou incompleta. Selecione outro arquivo.');
    let image,
      cleanup = () => {};
    try {
      if (typeof createImageBitmap === 'function') {
        image = await createImageBitmap(file, { imageOrientation: 'from-image' });
        cleanup = () => image.close();
      } else {
        // data: already belongs to the site's image policy; no broader blob: permission needed.
        const source = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error('Não foi possível ler a foto selecionada.'));
          reader.readAsDataURL(file);
        });
        image = new Image();
        cleanup = () => {
          image.src = '';
        };
        image.src = source;
        await image.decode(); // Modern image decoders apply EXIF once.
      }
      const width = image.naturalWidth || image.width,
        height = image.naturalHeight || image.height;
      if (!width || !height)
        throw Error('Imagem corrompida ou incompleta. Selecione outro arquivo.');
      if (width * height > limits.maxPixels)
        throw Error('A foto excede 20 milhões de pixels. Reduza a resolução antes de selecionar.');
      const scale = Math.min(1, limits.maxDimension / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw Error('Não foi possível preparar a foto neste navegador.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob;
      for (const quality of [0.85, 0.72, 0.58]) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw Error('Não foi possível comprimir a foto. Selecione outro arquivo.');
        if (blob.size <= limits.maxProcessedBytes) break;
      }
      if (blob.size > limits.maxProcessedBytes)
        throw Error('A foto ainda excede 3 MB após compressão. Escolha uma imagem menor.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('Não foi possível ler a foto processada.'));
        reader.readAsDataURL(blob);
      });
      return { data, width: canvas.width, height: canvas.height, bytes: blob.size };
    } catch (err) {
      if (err.name === 'InvalidStateError' || err.name === 'EncodingError')
        throw Error('Imagem corrompida ou incompleta. Selecione outro arquivo JPG, PNG ou WebP.');
      throw err;
    } finally {
      cleanup();
    }
  },
  async files(fileList, statusId) {
    const files = Array.from(fileList);
    if (files.length > (this.policy?.limits.maxPhotos || 3))
      throw Error('Selecione no máximo 3 fotos.');
    if (!files.length) return [];
    const result = [];
    let bytes = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        this.status(statusId, `Preparando foto ${i + 1} de ${files.length}…`);
        const processed = await this.process(files[i]);
        result.push(processed.data);
        bytes += processed.bytes;
      }
      this.status(
        statusId,
        `${files.length} foto(s) preparada(s): ${(bytes / 1024).toFixed(0)} KB ao todo, até 1280 px, sem metadados de localização.`,
      );
      return result;
    } catch (err) {
      this.status(statusId, 'Foto não enviada. Confira o erro e selecione outro arquivo.');
      throw err;
    }
  },
  async file(file, statusId) {
    if (!file) return null;
    return (await this.files([file], statusId))[0];
  },
  explainApproval() {
    const rule = this.policy?.approval;
    return rule
      ? `Para uma nova aprovação: pelo menos ${rule.minPhotos} foto(s) tecnicamente válida(s)${rule.minDescriptionChars > 1 ? ' e descrição com pelo menos ' + rule.minDescriptionChars + ' caracteres' : ' e descrição não vazia'}. Exceções só pela administração, com justificativa registrada. A conferência da foto com o animal é humana; validade técnica não comprova autenticidade nem detecta IA.`
      : '';
  },
};
