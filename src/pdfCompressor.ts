import { PDFDocument } from 'pdf-lib'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfCompressionResult = {
  blob: Blob
  originalSize: number
  compressedSize: number
  pageCount: number
}

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PDF 页面编码失败')), 'image/jpeg', quality)
})

export async function compressPdf(file: File, quality: number, maxEdge: number): Promise<PdfCompressionResult> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer())
  const loadingTask = getDocument({ data: sourceBytes })
  const source = await loadingTask.promise
  const output = await PDFDocument.create()

  try {
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = Math.min(2.5, maxEdge / Math.max(baseViewport.width, baseViewport.height))
      const viewport = page.getViewport({ scale: Math.max(1, scale) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('当前浏览器无法创建 PDF 渲染画布')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const jpeg = await canvasToJpeg(canvas, quality)
      const image = await output.embedJpg(await jpeg.arrayBuffer())
      const outputPage = output.addPage([baseViewport.width, baseViewport.height])
      outputPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })
      page.cleanup()
      canvas.width = 1
      canvas.height = 1
    }

    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 })
    const blob = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' })
    return { blob, originalSize: file.size, compressedSize: blob.size, pageCount: source.numPages }
  } finally {
    await source.destroy()
  }
}
