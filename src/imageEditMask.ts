export type ImageEditPoint = { x: number; y: number; radius: number }

function encodePng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法编码局部修改图片')), 'image/png')
  })
}

export async function prepareMaskedImageEdit(source: Blob, points: readonly ImageEditPoint[]) {
  const image = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法准备图像蒙版')
    context.drawImage(image, 0, 0)
    const original = await encodePng(canvas)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.globalCompositeOperation = 'destination-out'
    const shortEdge = Math.min(canvas.width, canvas.height)
    for (const { x, y, radius } of points) {
      context.beginPath()
      context.arc(x * canvas.width / 100, y * canvas.height / 100, radius * shortEdge / 100, 0, Math.PI * 2)
      context.fill()
    }
    return { original, mask: await encodePng(canvas) }
  } finally {
    image.close()
  }
}
