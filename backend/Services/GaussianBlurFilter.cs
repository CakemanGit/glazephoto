using System.Numerics;
using System.Threading.Tasks;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Advanced;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Services;

/// <summary>
/// Applies a separable Gaussian blur using parallel row processing.
/// </summary>
public sealed class GaussianBlurFilter
{
    private const float MaximumSigma = 32f;

    /// <summary>
    /// Blurs an image in place. The source is cloned once to keep both convolution
    /// passes independent while bounding temporary memory to one image.
    /// </summary>
    public void Apply(Image<Rgba32> image, float sigma)
    {
        ArgumentNullException.ThrowIfNull(image);
        if (!float.IsFinite(sigma) || sigma <= 0f || sigma > MaximumSigma)
        {
            throw new ArgumentOutOfRangeException(
                nameof(sigma),
                $"Sigma must be greater than 0 and no greater than {MaximumSigma}.");
        }

        int radius = Math.Max(1, (int)MathF.Ceiling(3f * sigma));
        float[] kernel = CreateKernel(sigma, radius);

        using Image<Rgba32> intermediate = image.Clone();

        Parallel.For(0, image.Height, y =>
        {
            Span<Rgba32> sourceRow = image.DangerousGetPixelRowMemory(y).Span;
            Span<Rgba32> destinationRow = intermediate.DangerousGetPixelRowMemory(y).Span;

            for (int x = 0; x < image.Width; x++)
            {
                Vector4 sum = Vector4.Zero;
                for (int offset = -radius; offset <= radius; offset++)
                {
                    int sampleX = Math.Clamp(x + offset, 0, image.Width - 1);
                    Vector4 sample = sourceRow[sampleX].ToScaledVector4();
                    sum += sample * kernel[offset + radius];
                }

                destinationRow[x] = Rgba32.FromScaledVector4(sum);
            }
        });

        Parallel.For(0, image.Height, y =>
        {
            Span<Rgba32> destinationRow = image.DangerousGetPixelRowMemory(y).Span;
            for (int x = 0; x < image.Width; x++)
            {
                Vector4 sum = Vector4.Zero;
                for (int offset = -radius; offset <= radius; offset++)
                {
                    int sampleY = Math.Clamp(y + offset, 0, image.Height - 1);
                    Span<Rgba32> sampleRow =
                        intermediate.DangerousGetPixelRowMemory(sampleY).Span;
                    sum += sampleRow[x].ToScaledVector4() * kernel[offset + radius];
                }

                destinationRow[x] = Rgba32.FromScaledVector4(sum);
            }
        });
    }

    private static float[] CreateKernel(float sigma, int radius)
    {
        var kernel = new float[(radius * 2) + 1];
        float denominator = 2f * sigma * sigma;
        float sum = 0f;

        for (int i = -radius; i <= radius; i++)
        {
            float weight = MathF.Exp(-(i * i) / denominator);
            kernel[i + radius] = weight;
            sum += weight;
        }

        for (int i = 0; i < kernel.Length; i++)
        {
            kernel[i] /= sum;
        }

        return kernel;
    }
}