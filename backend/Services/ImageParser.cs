using System.Numerics;
using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Http;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Services;

/// <summary>
/// Validates and decodes uploaded images, then applies pixel-level operations.
/// </summary>
public sealed class ImageParser
{
    private const long MaxFileSizeBytes = 50 * 1024 * 1024;
    private const long MaxPixelCount = 40_000_000;
    private const int MaxDimension = 16_384;

    /// <summary>
    /// Loads an uploaded image after validating its encoded size and dimensions.
    /// </summary>
    /// <remarks>The caller owns and must dispose the returned image.</remarks>
    public static async Task<Image<Rgba32>> LoadAsync(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(file);

        if (file.Length <= 0 || file.Length > MaxFileSizeBytes)
        {
            throw new InvalidDataException(
                $"Image file size must be between 1 byte and {MaxFileSizeBytes} bytes.");
        }

        await using Stream stream = file.OpenReadStream();
        var imageInfo = await Image.IdentifyAsync(stream, cancellationToken);
        if (imageInfo is null)
        {
            throw new InvalidDataException("The uploaded file is not a supported image.");
        }

        long pixelCount = (long)imageInfo.Width * imageInfo.Height;
        if (imageInfo.Width <= 0 ||
            imageInfo.Height <= 0 ||
            imageInfo.Width > MaxDimension ||
            imageInfo.Height > MaxDimension ||
            pixelCount > MaxPixelCount)
        {
            throw new InvalidDataException("Image dimensions exceed the supported limits.");
        }

        if (imageInfo.FrameCount != 1)
        {
            throw new InvalidDataException("Animated images are not supported.");
        }

        if (!stream.CanSeek)
        {
            throw new InvalidDataException("The uploaded image stream must be seekable.");
        }

        stream.Position = 0;
        return await Image.LoadAsync<Rgba32>(stream, cancellationToken);
    }

    /// <summary>Loads a validated image and inverts its RGB channels.</summary>
    public static async Task<Image<Rgba32>> LoadAndInvertAsync(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        Image<Rgba32> image = await LoadAsync(file, cancellationToken);
        InvertRgbChannels(image);
        return image;
    }

    private static void InvertRgbChannels(Image<Rgba32> image)
    {
        Span<byte> rgbMaskBytes = stackalloc byte[Vector<byte>.Count];
        Span<byte> alphaMaskBytes = stackalloc byte[Vector<byte>.Count];

        for (int i = 0; i < Vector<byte>.Count; i++)
        {
            bool isAlpha = i % 4 == 3;
            rgbMaskBytes[i] = isAlpha ? (byte)0 : byte.MaxValue;
            alphaMaskBytes[i] = isAlpha ? byte.MaxValue : (byte)0;
        }

        Vector<byte> rgbMask = new(rgbMaskBytes);
        Vector<byte> alphaMask = new(alphaMaskBytes);

        image.ProcessPixelRows(accessor =>
        {
            for (int y = 0; y < accessor.Height; y++)
            {
                Span<Rgba32> row = accessor.GetRowSpan(y);
                Span<byte> pixels = MemoryMarshal.AsBytes(row);
                int vectorWidth = Vector<byte>.Count;
                int offset = 0;

                for (; offset <= pixels.Length - vectorWidth; offset += vectorWidth)
                {
                    Vector<byte> source = new(pixels.Slice(offset, vectorWidth));
                    Vector<byte> invertedRgb = Vector.BitwiseAnd(
                        Vector.OnesComplement(source),
                        rgbMask);
                    Vector<byte> preservedAlpha = Vector.BitwiseAnd(source, alphaMask);
                    Vector<byte> result = Vector.BitwiseOr(invertedRgb, preservedAlpha);
                    result.CopyTo(pixels.Slice(offset, vectorWidth));
                }

                for (; offset < pixels.Length; offset += 4)
                {
                    pixels[offset] = (byte)~pixels[offset];
                    pixels[offset + 1] = (byte)~pixels[offset + 1];
                    pixels[offset + 2] = (byte)~pixels[offset + 2];
                }
            }
        });
    }
}