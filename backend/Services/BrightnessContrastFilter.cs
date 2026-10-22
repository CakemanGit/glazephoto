using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Services;

/// <summary>
/// Applies parallel, SIMD-accelerated brightness and contrast adjustments.
/// </summary>
public sealed class BrightnessContrastFilter(SimdOptimizer optimizer)
{
    /// <summary>
    /// Adjusts RGB channels in place while retaining each pixel's alpha value.
    /// Brightness and contrast must each be between -1 and 1.
    /// </summary>
    public void Apply(
        Image<Rgba32> image,
        float brightness,
        float contrast)
    {
        optimizer.AdjustBrightnessContrast(image, brightness, contrast);
    }
}