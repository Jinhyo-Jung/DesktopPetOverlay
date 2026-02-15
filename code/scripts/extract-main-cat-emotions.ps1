$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$sourcePath = Join-Path $root "source\01_cat_multiple_expression_variations.png"
$outputDir = Join-Path $root "source\pet_emotions\main_cat"

if (!(Test-Path $sourcePath)) {
  throw "Source image not found: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$sheet = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  $frameSize = 512
  $frames = @(
    @{ id = "neutral"; x = 0; y = 0 },
    @{ id = "happy"; x = 512; y = 0 },
    @{ id = "tired"; x = 0; y = 512 },
    @{ id = "sleep"; x = 512; y = 512 }
  )

  foreach ($frame in $frames) {
    $rect = New-Object System.Drawing.Rectangle($frame.x, $frame.y, $frameSize, $frameSize)
    $crop = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $target = Join-Path $outputDir ($frame.id + ".png")
      $crop.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output ("EMOTION_FRAME_EXTRACTED " + $target)
    } finally {
      $crop.Dispose()
    }
  }
} finally {
  $sheet.Dispose()
}
