param([string]$ImagePath, [switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$failureCode = 'OCR_PLATFORM_UNAVAILABLE'
$stream = $null
$bitmap = $null
$variantPaths = @()
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object LanguageTag)
  $failureCode = 'OCR_LANGUAGE_UNAVAILABLE'
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
  $language = New-Object Windows.Globalization.Language('tr')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  if ($null -eq $engine) { throw 'OCR_LANGUAGE_UNAVAILABLE' }
  if ($Probe) {
    @{ok=$true;engine='windows-media-ocr';language=$engine.RecognizerLanguage.LanguageTag;maxDimension=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension} | ConvertTo-Json -Compress
    exit 0
  }
  $failureCode = 'OCR_INPUT_REJECTED'
  $workRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot -Parent) '.local/ocr-work')) + [IO.Path]::DirectorySeparatorChar
  $resolved = (Resolve-Path -LiteralPath $ImagePath).Path
  if (-not $resolved.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'OCR_INPUT_REJECTED' }
  $item = Get-Item -LiteralPath $resolved
  if ($item.Length -gt 5242880 -or $item.Length -lt 4 -or $item.PSIsContainer) { throw 'OCR_INPUT_REJECTED' }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  function Await-Operation($Operation, [Type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
  }
  function Recognize-Path([string]$Path) {
    $localStream = $null
    $localBitmap = $null
    try {
      $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
      $localStream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($localStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      if ([long]$decoder.PixelWidth * [long]$decoder.PixelHeight -gt 16000000 -or $decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw 'OCR_IMAGE_TOO_LARGE' }
      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      $localBitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      return @{ result = (Await-Operation ($engine.RecognizeAsync($localBitmap)) ([Windows.Media.Ocr.OcrResult])); width = $localBitmap.PixelWidth; height = $localBitmap.PixelHeight }
    } finally {
      if ($null -ne $localBitmap) { $localBitmap.Dispose() }
      if ($null -ne $localStream) { $localStream.Dispose() }
    }
  }
  function Get-OcrText($Result) {
    return (($Result.Lines | ForEach-Object { ($_.Words | ForEach-Object Text) -join ' ' }) -join "`n")
  }
  function Get-NormalizedOcrText([string]$Text) {
    return (($Text.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '') -replace '[ıİ]', 'i').ToUpperInvariant()
  }
  function Get-OcrScore($Result, [switch]$ShiftTableCandidate) {
    $text = Get-OcrText $Result
    $normalized = Get-NormalizedOcrText $text
    $score = 0
    if ($normalized -match '(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}') { $score += 8 }
    if ($normalized -match '\d{2}[./-]\d{2}[./-]\d{4}') { $score += 5 }
    foreach ($pattern in @('FAST', 'SATIS', 'HALKBANK', 'POS\s*N[O0]', 'KAREKOD\s*REF', 'ONAY\s*KODU', 'ISLEM\s*NO', 'BATCH', 'TUTAR', 'TERMINAL', 'REFERANS')) {
      if ($normalized -match $pattern) { $score += 2 }
    }
    if ($ShiftTableCandidate -or $normalized -match '(?:OSSE|POMPACI|VARDIYA)') {
      foreach ($pattern in @('OSSE\s*ADI', 'POMPACI', 'SATIS\s*ADEDI', 'SATIS\s*TUTARI', 'GIFT\s*CARD', '\bTTS\b')) {
        if ($normalized -match $pattern) { $score += 4 }
      }
      $amountCount = [regex]::Matches($normalized, '(?<!\d)(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)').Count
      $score += [math]::Min(12, $amountCount * 2)
      if ($ShiftTableCandidate) {
        $countLike = [regex]::Matches($normalized, '(?<!\d)\d{2,4}(?!\d)').Count
        $score += [math]::Min(8, $countLike)
      }
    }
    return $score
  }
  $failureCode = 'OCR_DECODE_FAILED'
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
  $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $failureCode = 'OCR_IMAGE_TOO_LARGE'
  if ([long]$decoder.PixelWidth * [long]$decoder.PixelHeight -gt 16000000 -or $decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw 'OCR_IMAGE_TOO_LARGE' }
  $failureCode = 'OCR_DECODE_FAILED'
  $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $failureCode = 'OCR_RECOGNITION_FAILED'
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $bestResult = $result
  $bestScore = Get-OcrScore $result
  $bestStrategy = 'original'
  $bestPath = $resolved
  $strategyScores = @(@{ strategy='original'; score=$bestScore })
  $preprocessingIssue = $null
  try {
    Add-Type -AssemblyName System.Drawing
    $preprocessType = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class StationPosSlipPreprocess {
  public static Bitmap Transform(string path, int mode) {
    using (var input = (Bitmap)Image.FromFile(path)) {
      int scale = mode==3?2:1; int targetWidth=input.Width*scale,targetHeight=input.Height*scale;
      using (var normalized = new Bitmap(targetWidth, targetHeight, PixelFormat.Format24bppRgb)) {
        using (var graphics = Graphics.FromImage(normalized)) { graphics.Clear(Color.White); graphics.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; graphics.DrawImage(input, 0, 0, targetWidth, targetHeight); }
        var rect = new Rectangle(0, 0, normalized.Width, normalized.Height);
        var data = normalized.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        var stride = Math.Abs(data.Stride); var pixels = new byte[stride * normalized.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length); normalized.UnlockBits(data);
        var width = normalized.Width; var height = normalized.Height; var gray = new byte[width * height];
        for (int y=0; y<height; y++) for (int x=0; x<width; x++) { int i=y*stride+x*3; gray[y*width+x]=(byte)Math.Min(255,(pixels[i]*29+pixels[i+1]*150+pixels[i+2]*77+128)>>8); }
        int[] integral = null;
        if (mode == 2) {
          int w1=width+1; integral=new int[w1*(height+1)];
          for(int y=0;y<height;y++){ int row=0; for(int x=0;x<width;x++){row+=gray[y*width+x]; integral[(y+1)*w1+x+1]=integral[y*w1+x+1]+row;}}
        }
        var output = new Bitmap(width,height,PixelFormat.Format24bppRgb); var outData=output.LockBits(rect,ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb); var outStride=Math.Abs(outData.Stride); var bytes=new byte[outStride*height];
        int radius=Math.Max(12,(int)(Math.Min(width,height)*0.018));
        for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
          int lum=gray[y*width+x], value;
          if(mode==2){int x0=Math.Max(0,x-radius),x1=Math.Min(width,x+radius+1),y0=Math.Max(0,y-radius),y1=Math.Min(height,y+radius+1),w1=width+1; long sum=integral[y1*w1+x1]-integral[y0*w1+x1]-integral[y1*w1+x0]+integral[y0*w1+x0]; double avg=(double)sum/((x1-x0)*(y1-y0)); value=lum<avg-24?0:255;}
          else { value=(int)Math.Max(0,Math.Min(255,(lum-128)*1.65+128)); }
          int j=y*outStride+x*3; bytes[j]=bytes[j+1]=bytes[j+2]=(byte)value;
        }
        Marshal.Copy(bytes,0,outData.Scan0,bytes.Length); output.UnlockBits(outData); return output;
      }
    }
  }
  public static Bitmap Rotate(string path, float degrees) {
    using (var input=(Bitmap)Image.FromFile(path)) {
      double radians=degrees*Math.PI/180.0; int w=(int)Math.Ceiling(input.Width*Math.Abs(Math.Cos(radians))+input.Height*Math.Abs(Math.Sin(radians))); int h=(int)Math.Ceiling(input.Height*Math.Abs(Math.Cos(radians))+input.Width*Math.Abs(Math.Sin(radians)));
      var output=new Bitmap(w,h,PixelFormat.Format24bppRgb); using(var g=Graphics.FromImage(output)){g.Clear(Color.White);g.TranslateTransform(w/2f,h/2f);g.RotateTransform(-degrees);g.DrawImage(input,-input.Width/2f,-input.Height/2f,input.Width,input.Height);} return output;
    }
  }
  public static Bitmap CropShiftTable(string path) {
    using (var input=(Bitmap)Image.FromFile(path)) {
      using (var source = new Bitmap(input.Width,input.Height,PixelFormat.Format24bppRgb)) {
        using(var g=Graphics.FromImage(source)){g.Clear(Color.White);g.DrawImage(input,0,0,input.Width,input.Height);}
        var sourceRect=new Rectangle(0,0,source.Width,source.Height);
        var sourceData=source.LockBits(sourceRect,ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);
        var sourceStride=Math.Abs(sourceData.Stride);var sourceBytes=new byte[sourceStride*source.Height];
        Marshal.Copy(sourceData.Scan0,sourceBytes,0,sourceBytes.Length);source.UnlockBits(sourceData);
        // Bilinear warp maps the photographed report table's trapezoid to a rectangle.
        double tlx=.085*source.Width,tly=.465*source.Height,trx=.95*source.Width,tryy=.475*source.Height;
        double blx=.105*source.Width,bly=.64*source.Height,brx=.92*source.Width,bry=.63*source.Height;
        int outW=(int)Math.Max(trx-tlx,brx-blx),outH=(int)Math.Max(bly-tly,bry-tryy);
        outW=Math.Max(1,Math.Min(outW,source.Width));outH=Math.Max(1,Math.Min(outH,source.Height));
        var output=new Bitmap(outW,outH,PixelFormat.Format24bppRgb);
        var outputRect=new Rectangle(0,0,outW,outH);var outputData=output.LockBits(outputRect,ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb);
        var outputStride=Math.Abs(outputData.Stride);var outputBytes=new byte[outputStride*outH];
        for(int y=0;y<outH;y++){
          double v=outH<=1?0:(double)y/(outH-1);
          for(int x=0;x<outW;x++){
            double u=outW<=1?0:(double)x/(outW-1),topX=tlx+(trx-tlx)*u,bottomX=blx+(brx-blx)*u,topY=tly+(tryy-tly)*u,bottomY=bly+(bry-bly)*u,sx=topX+(bottomX-topX)*v,sy=topY+(bottomY-topY)*v;
            int ix=Math.Max(0,Math.Min(source.Width-1,(int)Math.Round(sx))),iy=Math.Max(0,Math.Min(source.Height-1,(int)Math.Round(sy))),si=iy*sourceStride+ix*3,oi=y*outputStride+x*3;
            outputBytes[oi]=sourceBytes[si];outputBytes[oi+1]=sourceBytes[si+1];outputBytes[oi+2]=sourceBytes[si+2];
          }
        }
        Marshal.Copy(outputBytes,0,outputData.Scan0,outputBytes.Length);output.UnlockBits(outputData);return output;
      }
    }
  }
}
'@
    Add-Type -TypeDefinition $preprocessType -ReferencedAssemblies @('System.Drawing.dll')
    foreach ($mode in @(1,2,3)) {
      $name = if ($mode -eq 1) { 'contrast' } elseif ($mode -eq 2) { 'shadow' } else { 'upscale' }
      $variantPath = Join-Path (Split-Path $resolved -Parent) ("pos-" + [guid]::NewGuid().ToString('N') + ".png")
      $variant = [StationPosSlipPreprocess]::Transform($resolved, $mode)
      try { $variant.Save($variantPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $variant.Dispose() }
      $variantPaths += $variantPath
      $candidate = Recognize-Path $variantPath
      $candidateScore = Get-OcrScore $candidate.result
      $strategyScores += @{ strategy=$name; score=$candidateScore }
      if ($candidateScore -gt $bestScore) { $bestResult=$candidate.result; $bestScore=$candidateScore; $bestStrategy=$name; $bestPath=$variantPath }
    }
    if ((Get-NormalizedOcrText (Get-OcrText $bestResult)) -match '(?:OSSE|POMPACI|VARDIYA)') {
      $cropPath = Join-Path (Split-Path $resolved -Parent) ("shift-table-" + [guid]::NewGuid().ToString('N') + ".png")
      $crop = [StationPosSlipPreprocess]::CropShiftTable($resolved)
      try { $crop.Save($cropPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
      $variantPaths += $cropPath
      $candidate = Recognize-Path $cropPath
      $cropScore = Get-OcrScore $candidate.result -ShiftTableCandidate
      $cropText = Get-OcrText $candidate.result
      $normalizedCropText = Get-NormalizedOcrText $cropText
      $cropHeader = $normalizedCropText -match '(?is)(?:OSSE|POMPACI).{0,80}SATIS.{0,40}ADEDI.{0,80}SATIS.{0,40}TUTARI'
      $cropRows = [regex]::Matches($normalizedCropText, '(?im)^\s*[\p{L}][\p{L}\s.''-]{1,40}\s+\d{2,4}\s+(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)').Count
      $cropQualityScore = $cropScore + [math]::Min(20, $cropRows * 5) + $(if ($cropHeader) { 8 } else { 0 })
      $strategyScores += @{ strategy='shift-table-crop'; score=$cropScore; reportRows=$cropRows; headerDetected=$cropHeader }
      if ($cropQualityScore -gt $bestScore) { $bestResult=$candidate.result; $bestScore=$cropQualityScore; $bestStrategy='shift-table-crop'; $bestPath=$cropPath }
      foreach ($cropMode in @(1,2,3)) {
        $cropVariantName = if($cropMode -eq 1){'shift-table-contrast'}elseif($cropMode -eq 2){'shift-table-shadow'}else{'shift-table-upscale'}
        $cropVariantPath = Join-Path (Split-Path $resolved -Parent) ($cropVariantName + '-' + [guid]::NewGuid().ToString('N') + '.png')
        $cropVariant = [StationPosSlipPreprocess]::Transform($cropPath,$cropMode)
        try{$cropVariant.Save($cropVariantPath,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$cropVariant.Dispose()}
        $variantPaths += $cropVariantPath
        $cropProcessed = Recognize-Path $cropVariantPath
        $processedScore = Get-OcrScore $cropProcessed.result -ShiftTableCandidate
        $processedText = Get-NormalizedOcrText (Get-OcrText $cropProcessed.result)
        $processedHeader = $processedText -match '(?is)(?:OSSE|POMPACI).{0,100}SATIS.{0,50}ADEDI.{0,100}SATIS.{0,50}TUTARI'
        $processedRows = [regex]::Matches($processedText,'(?im)^\s*[\p{L}][\p{L}\s.''-]{1,40}\s+\d{2,4}\s+(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)').Count
        $processedQuality = $processedScore + [math]::Min(30,$processedRows*7) + $(if($processedHeader){12}else{0})
        $strategyScores += @{strategy=$cropVariantName;score=$processedScore;reportRows=$processedRows;headerDetected=$processedHeader}
        if($processedQuality -gt $bestScore){$bestResult=$cropProcessed.result;$bestScore=$processedQuality;$bestStrategy=$cropVariantName;$bestPath=$cropVariantPath}
      }
    }
    if ($null -ne $bestResult.TextAngle -and [Math]::Abs([double]$bestResult.TextAngle) -ge 0.6 -and [Math]::Abs([double]$bestResult.TextAngle) -le 8) {
      $deskewPath = Join-Path (Split-Path $resolved -Parent) ("pos-deskew-" + [guid]::NewGuid().ToString('N') + ".png")
      $deskew = [StationPosSlipPreprocess]::Rotate($bestPath, [float]$bestResult.TextAngle)
      try { $deskew.Save($deskewPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $deskew.Dispose() }
      $variantPaths += $deskewPath
      $candidate = Recognize-Path $deskewPath
      $deskewScore = Get-OcrScore $candidate.result
      $strategyScores += @{ strategy='deskew'; score=$deskewScore }
      if ($deskewScore -gt $bestScore) { $bestResult=$candidate.result; $bestScore=$deskewScore; $bestStrategy='deskew'; $bestPath=$deskewPath }
    }
  } catch { $preprocessingIssue = $_.Exception.Message }
  $lines = @()
  foreach ($line in $bestResult.Lines) {
    $words = @()
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      $words += @{text=$word.Text;x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}
    }
    $lines += @{words=$words}
  }
  @{ok=$true;engine='windows-media-ocr';language=$engine.RecognizerLanguage.LanguageTag;width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;angle=$bestResult.TextAngle;preprocessing=$bestStrategy;preprocessingScores=$strategyScores;preprocessingIssue=$preprocessingIssue;lines=$lines} | ConvertTo-Json -Depth 8 -Compress
} catch {
  @{ok=$false;code=$failureCode} | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
  foreach ($variantPath in $variantPaths) { try { [IO.File]::Delete($variantPath) } catch {} }
}
