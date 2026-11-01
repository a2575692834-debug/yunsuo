param(
  [string]$OutputPath = (Join-Path $PSScriptRoot 'icon.png')
)

Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$size = 1024
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$bounds = [System.Drawing.RectangleF]::new(64, 64, 896, 896)
$outer = New-RoundedPath 64 64 896 896 210
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $bounds,
  [System.Drawing.Color]::FromArgb(255, 23, 33, 30),
  [System.Drawing.Color]::FromArgb(255, 10, 91, 82),
  42
)
$blend = [System.Drawing.Drawing2D.ColorBlend]::new(3)
$blend.Colors = @(
  [System.Drawing.Color]::FromArgb(255, 20, 31, 28),
  [System.Drawing.Color]::FromArgb(255, 11, 110, 98),
  [System.Drawing.Color]::FromArgb(255, 8, 69, 63)
)
$blend.Positions = @(0.0, 0.51, 1.0)
$gradient.InterpolationColors = $blend
$graphics.FillPath($gradient, $outer)

$glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22, 255, 238, 203))
$graphics.FillEllipse($glow, 300, 180, 590, 590)

$random = [System.Random]::new(4747)
for ($i = 0; $i -lt 440; $i++) {
  $x = $random.Next(90, 934)
  $y = $random.Next(90, 934)
  $alpha = $random.Next(3, 13)
  $dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, 255, 249, 232))
  $graphics.FillEllipse($dot, $x, $y, 2, 2)
  $dot.Dispose()
}

$linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(20, 255, 248, 228), 2)
for ($offset = -220; $offset -le 720; $offset += 78) {
  $graphics.DrawLine($linePen, 110, 250 + $offset, 340, -20 + $offset)
}
$linePen.Dispose()

$orbitOne = [System.Drawing.Drawing2D.GraphicsPath]::new()
$orbitOne.StartFigure()
$orbitOne.AddBezier(154, 728, 315, 882, 693, 893, 872, 646)
$orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(236, 238, 92, 59), 18)
$orbitPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$orbitPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawPath($orbitPen, $orbitOne)
$orbitPen.Dispose()
$orbitOne.Dispose()

$orbitTwo = [System.Drawing.Drawing2D.GraphicsPath]::new()
$orbitTwo.StartFigure()
$orbitTwo.AddBezier(184, 650, 358, 750, 628, 767, 823, 596)
$orbitTwoPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(190, 237, 188, 87), 8)
$orbitTwoPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$orbitTwoPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawPath($orbitTwoPen, $orbitTwo)
$orbitTwoPen.Dispose()
$orbitTwo.Dispose()

$accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 238, 192, 104))
$graphics.FillEllipse($accent, 830, 586, 57, 57)
$accent.Dispose()
$accentRing = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(90, 255, 243, 219), 3)
$graphics.DrawEllipse($accentRing, 822, 578, 73, 73)
$accentRing.Dispose()

$fontFamily = [System.Drawing.FontFamily]::new('Microsoft YaHei UI')
$font = [System.Drawing.Font]::new($fontFamily, 388, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBounds = [System.Drawing.RectangleF]::new(178, 185, 668, 675)
$textShadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(70, 0, 42, 38))
$shadowBounds = [System.Drawing.RectangleF]::new(186, 199, 668, 675)
$graphics.DrawString('梭', $font, $textShadow, $shadowBounds, $format)
$textShadow.Dispose()
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 250, 237))
$graphics.DrawString('梭', $font, $textBrush, $textBounds, $format)
$textBrush.Dispose()

$innerBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(42, 255, 248, 229), 3)
$innerPath = New-RoundedPath 91 91 842 842 187
$graphics.DrawPath($innerBorder, $innerPath)
$innerBorder.Dispose()
$innerPath.Dispose()

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  [System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$format.Dispose()
$font.Dispose()
$fontFamily.Dispose()
$glow.Dispose()
$gradient.Dispose()
$outer.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $OutputPath
