using System.Numerics;
using System.Threading.Tasks;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Advanced;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Services;

/// <summary>
/// Applies SIMD-friendly color operations to RGBA images.
/// </summary>
public sealed class SimdOptimizer
{
    /// <summary>
    /// Inverts each pixel's RGB channels and leaves its alpha unchanged.
    /// Vector4 operations use the runtime's hardware acceleration when available.
    /// </summary>
    public void InvertRgba(Image<Rgba32> image)
    {
        ArgumentNullException.ThrowIfNull(image);

        Parallel.For(0, image.Height, y =>
        {
            Span<Rgba32> row = image.DangerousGetPixelRowMemory(y).Span;
            for (int x = 0; x < row.Length; x++)
            {
                Vector4 pixel = row[x].ToScaledVector4();
                Vector4 inverted = new(
                    Vector4.One.X - pixel.X,
                    Vector4.One.Y - pixel.Y,
                    Vector4.One.Z - pixel.Z,
                    pixel.W);
                row[x] = Rgba32.FromScaledVector4(inverted);
            }
        });
    }

    /// <summary>
    /// Adjusts RGB brightness and contrast. Brightness and contrast are expected
    /// in the range [-1, 1]; alpha is preserved.
    /// </summary>
    public void AdjustBrightnessContrast(
        Image<Rgba32> image,
        float brightness,
        float contrast)
    {
        ArgumentNullException.ThrowIfNull(image);
        ValidateUnitRange(brightness, nameof(brightness));
        ValidateUnitRange(contrast, nameof(contrast));

        float contrastFactor = 1f + contrast;
        Vector4 midpoint = new(0.5f, 0.5f, 0.5f, 0f);
        Vector4 adjustment = new(brightness, brightness, brightness, 0f);
        Vector4 minimum = Vector4.Zero;
        Vector4 maximum = Vector4.One;

        Parallel.For(0, image.Height, y =>
        {
            Span<Rgba32> row = image.DangerousGetPixelRowMemory(y).Span;
            for (int x = 0; x < row.Length; x++)
            {
                Vector4 pixel = row[x].ToScaledVector4();
                Vector4 rgb = (pixel - midpoint) * contrastFactor + midpoint + adjustment;
                rgb.W = pixel.W;
                row[x] = Rgba32.FromScaledVector4(Vector4.Clamp(rgb, minimum, maximum));
            }
        });
    }

    private static void ValidateUnitRange(float value, string parameterName)
    {
        if (!float.IsFinite(value) || value < -1f || value > 1f)
        {
            throw new ArgumentOutOfRangeException(
                parameterName,
                "Value must be a finite number between -1 and 1.");
        }
    }
}