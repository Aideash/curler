import crypto from 'node:crypto'
import { checkUploadPath, filePathFromValue, readUploadFile } from './paths.mjs'
import { formatUploadLimitMb, getUploadPolicy } from './uploadPolicy.mjs'

function escapeDispositionToken(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {Array<{ name: string, value: string, filename?: string, contentType?: string, textOnly?: boolean }>} parts
 * @param {{ policy?: ReturnType<typeof getUploadPolicy> }} [options]
 */
export function encodeMultipartBody(parts, options = {}) {
  if (!parts?.length) {
    throw new Error('Multipart body has no parts.')
  }

  const policy = options.policy ?? getUploadPolicy()
  const fileParts = []

  for (const part of parts) {
    const filePath = filePathFromValue(part.value, Boolean(part.textOnly))
    if (filePath) fileParts.push({ part, filePath })
  }

  if (fileParts.length > policy.maxFileParts) {
    throw new Error(`Multipart body has too many file parts (max ${policy.maxFileParts}).`)
  }

  let totalBytes = 0
  for (const part of parts) {
    if (!filePathFromValue(part.value, Boolean(part.textOnly))) {
      totalBytes += Buffer.byteLength(part.value, 'utf8')
    }
  }

  for (const { filePath } of fileParts) {
    const checked = checkUploadPath(filePath, process.cwd(), policy)
    if (!checked.ok) throw new Error(checked.message)
    totalBytes += checked.size
  }

  if (totalBytes > policy.maxUploadBytes) {
    throw new Error(
      `Multipart body exceeds the ${formatUploadLimitMb(policy.maxUploadBytes)} MB upload limit.`,
    )
  }

  const boundary = `----CurlerFormBoundary${crypto.randomBytes(16).toString('hex')}`
  const buffers = []

  for (const part of parts) {
    const filePath = filePathFromValue(part.value, Boolean(part.textOnly))
    let bodyBuffer
    let filename = part.filename

    if (filePath) {
      const file = readUploadFile(filePath, part.filename, process.cwd(), policy)
      bodyBuffer = file.data
      filename = file.filename
    } else {
      bodyBuffer = Buffer.from(part.value, 'utf8')
    }

    let disposition = `form-data; name="${escapeDispositionToken(part.name)}"`
    if (filename) {
      disposition += `; filename="${escapeDispositionToken(filename)}"`
    }

    buffers.push(Buffer.from(`--${boundary}\r\n`, 'utf8'))
    buffers.push(Buffer.from(`Content-Disposition: ${disposition}\r\n`, 'utf8'))
    if (part.contentType) {
      buffers.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`, 'utf8'))
    }
    buffers.push(Buffer.from('\r\n', 'utf8'))
    buffers.push(bodyBuffer)
    buffers.push(Buffer.from('\r\n', 'utf8'))
  }

  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))

  const buffer = Buffer.concat(buffers)
  return {
    buffer,
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}
