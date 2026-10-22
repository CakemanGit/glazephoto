using System.IO.Compression;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Services;

/// <summary>Project data required to create a session archive or flattened export.</summary>
public sealed record ProjectExportRequest(
    string ProjectName,
    IReadOnlyList<ProjectLayerExport> Layers);

/// <summary>Layer metadata and its encoded image payload.</summary>
public sealed record ProjectLayerExport(
    string Id,
    string Name,
    int Width,
    int Height,
    float Opacity,
    bool Visible,
    string BlendMode,
    int OffsetX,
    int OffsetY,
    byte[] ImageData);

/// <summary>Builds downloadable project archives and flattened image files.</summary>
public sealed class ProjectExporter
{
    private const int MaxLayers = 100;
    private const int MaxDimension = 16_384;
    private const long MaxPixelCount = 40_000_000;
    private const int MaxLayerFileSize = 50 * 1024 * 1024;
    private const long MaxProjectImageDataBytes = 250L * 1024 * 1024;

    /// <summary>Creates a ZIP containing project metadata and each original layer image.</summary>
    public async Task<FileContentResult> CreateSessionArchiveAsync(
        ProjectExportRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(request);
        await ValidateLayerImagesAsync(request.Layers, cancellationToken);

        await using var archiveStream = new MemoryStream();
        using (var archive = new ZipArchive(
                   archiveStream,
                   ZipArchiveMode.Create,
                   leaveOpen: true))
        {
            var metadata = archive.CreateEntry("project.json", CompressionLevel.Fastest);
            await using (Stream metadataStream = metadata.Open())
            {
                var layerMetadata = request.Layers.Select((layer, index) => new
                {
                    layer.Id,
                    layer.Name,
                    layer.Width,
                    layer.Height,
                    layer.Opacity,
                    layer.Visible,
                    layer.BlendMode,
                    layer.OffsetX,
                    layer.OffsetY,
                    ImageFile = $"layers/{index:D4}.bin",
                });

                await JsonSerializer.SerializeAsync(
                    metadataStream,
                    new { request.ProjectName, Layers = layerMetadata },
                    cancellationToken: cancellationToken);
            }

            for (int i = 0; i < request.Layers.Count; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var entry = archive.CreateEntry(
                    $"layers/{i:D4}.bin",
                    CompressionLevel.NoCompression);
                await using Stream entryStream = entry.Open();
                await entryStream.WriteAsync(
                    request.Layers[i].ImageData,
                    cancellationToken);
            }
        }

        string fileName = $"{CreateSafeFileName(request.ProjectName)}.glaze.zip";
        return new FileContentResult(archiveStream.ToArray(), "application/zip")
        {
            FileDownloadName = fileName,
        };
    }

    /// <summary>Composites visible layers from bottom to top into PNG or JPEG.</summary>
    public async Task<FileContentResult> CreateFlattenedImageAsync(
        ProjectExportRequest request,
        string format,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(request);
        format = format.Trim().ToLowerInvariant();
        if (format is not ("png" or "jpeg" or "jpg"))
        {
            throw new ArgumentException("Export format must be png or jpeg.", nameof(format));
        }

        await ValidateLayerImagesAsync(request.Layers, cancellationToken);
        var visibleLayers = request.Layers.Where(layer => layer.Visible).ToArray();
        if (visibleLayers.Length == 0)
        {
            throw new ArgumentException("The project has no visible layers.", nameof(request));
        }

        foreach (var layer in visibleLayers)
        {
            if (!string.Equals(layer.BlendMode, "normal", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    $"Flattened export does not support blend mode '{layer.BlendMode}'.",
                    nameof(request));
            }
        }

        int minX = visibleLayers.Min(layer => layer.OffsetX);
        int minY = visibleLayers.Min(layer => layer.OffsetY);
        long maxX = visibleLayers.Max(layer => (long)layer.OffsetX + layer.Width);
        long maxY = visibleLayers.Max(layer => (long)layer.OffsetY + layer.Height);
        long width = maxX - minX;
        long height = maxY - minY;
        if (width <= 0 || height <= 0 ||
            width > MaxDimension || height > MaxDimension ||
            width * height > MaxPixelCount)
        {
            throw new ArgumentException("Flattened image dimensions exceed the supported limits.", nameof(request));
        }

        using var flattened = new Image<Rgba32>((int)width, (int)height);
        foreach (var layer in visibleLayers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using Image<Rgba32> source = await DecodeLayerAsync(layer, cancellationToken);
            CompositeLayer(
                flattened,
                source,
                layer,
                checked(layer.OffsetX - minX),
                checked(layer.OffsetY - minY));
        }

        string mediaType;
        string extension;
        await using var output = new MemoryStream();
        if (format == "png")
        {
            mediaType = "image/png";
            extension = "png";
            await flattened.SaveAsPngAsync(output, cancellationToken);
        }
        else
        {
            CompositeOnWhite(flattened);
            mediaType = "image/jpeg";
            extension = "jpg";
            await flattened.SaveAsJpegAsync(output, cancellationToken);
        }

        return new FileContentResult(output.ToArray(), mediaType)
        {
            FileDownloadName = $"{CreateSafeFileName(request.ProjectName)}.{extension}",
        };
    }

    private static void ValidateRequest(ProjectExportRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.ProjectName))
        {
            throw new ArgumentException("Project name is required.", nameof(request));
        }

        if (request.Layers is null || request.Layers.Count == 0 ||
            request.Layers.Count > MaxLayers)
        {
            throw new ArgumentException(
                $"Project must contain between 1 and {MaxLayers} layers.",
                nameof(request));
        }

        long totalImageBytes = 0;
        var layerIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var layer in request.Layers)
        {
            if (string.IsNullOrWhiteSpace(layer.Id) ||
                !layerIds.Add(layer.Id) ||
                string.IsNullOrWhiteSpace(layer.Name) ||
                layer.Width <= 0 || layer.Height <= 0 ||
                layer.Width > MaxDimension || layer.Height > MaxDimension ||
                (long)layer.Width * layer.Height > MaxPixelCount ||
                !float.IsFinite(layer.Opacity) || layer.Opacity is < 0 or > 1 ||
                layer.ImageData is null || layer.ImageData.Length == 0 ||
                layer.ImageData.Length > MaxLayerFileSize)
            {
                throw new ArgumentException("A project layer has invalid metadata or image data.", nameof(request));
            }

            totalImageBytes += layer.ImageData.Length;
            if (totalImageBytes > MaxProjectImageDataBytes)
            {
                throw new ArgumentException(
                    $"Total layer image data cannot exceed {MaxProjectImageDataBytes} bytes.",
                    nameof(request));
            }
        }
    }

    private static async Task ValidateLayerImagesAsync(
        IReadOnlyList<ProjectLayerExport> layers,
        CancellationToken cancellationToken)
    {
        foreach (var layer in layers)
        {
            using Image<Rgba32> image = await DecodeLayerAsync(layer, cancellationToken);
        }
    }

    private static async Task<Image<Rgba32>> DecodeLayerAsync(
        ProjectLayerExport layer,
        CancellationToken cancellationToken)
    {
        await using var input = new MemoryStream(layer.ImageData, writable: false);
        var info = await Image.IdentifyAsync(input, cancellationToken);
        if (info is null ||
            info.Width != layer.Width ||
            info.Height != layer.Height ||
            info.FrameCount != 1)
        {
            throw new InvalidDataException(
                $"Layer '{layer.Name}' image data does not match its metadata or is animated.");
        }

        input.Position = 0;
        return await Image.LoadAsync<Rgba32>(input, cancellationToken);
    }

    private static void CompositeLayer(
        Image<Rgba32> destination,
        Image<Rgba32> source,
        ProjectLayerExport metadata,
        int offsetX,
        int offsetY)
    {
        destination.ProcessPixelRows(source, (destinationRows, sourceRows) =>
        {
            int startY = Math.Max(0, offsetY);
            int endY = Math.Min(destinationRows.Height, offsetY + sourceRows.Height);
            int startX = Math.Max(0, offsetX);
            int endX = Math.Min(destinationRows.Width, offsetX + sourceRows.Width);

            for (int y = startY; y < endY; y++)
            {
                Span<Rgba32> destinationRow = destinationRows.GetRowSpan(y);
                Span<Rgba32> sourceRow = sourceRows.GetRowSpan(y - offsetY);

                for (int x = startX; x < endX; x++)
                {
                    Rgba32 foreground = sourceRow[x - offsetX];
                    if (metadata.Opacity < 1f)
                    {
                        foreground.A = (byte)MathF.Round(foreground.A * metadata.Opacity);
                    }

                    destinationRow[x] = AlphaOver(foreground, destinationRow[x]);
                }
            }
        });
    }

    private static Rgba32 AlphaOver(Rgba32 source, Rgba32 destination)
    {
        float sourceAlpha = source.A / 255f;
        float destinationAlpha = destination.A / 255f;
        float outputAlpha = sourceAlpha + destinationAlpha * (1f - sourceAlpha);
        if (outputAlpha <= 0f)
        {
            return default;
        }

        float destinationWeight = destinationAlpha * (1f - sourceAlpha);
        return new Rgba32(
            ToByte((source.R * sourceAlpha + destination.R * destinationWeight) / outputAlpha),
            ToByte((source.G * sourceAlpha + destination.G * destinationWeight) / outputAlpha),
            ToByte((source.B * sourceAlpha + destination.B * destinationWeight) / outputAlpha),
            ToByte(outputAlpha * 255f));
    }

    private static void CompositeOnWhite(Image<Rgba32> image)
    {
        image.ProcessPixelRows(accessor =>
        {
            for (int y = 0; y < accessor.Height; y++)
            {
                Span<Rgba32> row = accessor.GetRowSpan(y);
                for (int x = 0; x < row.Length; x++)
                {
                    Rgba32 pixel = row[x];
                    float alpha = pixel.A / 255f;
                    row[x] = new Rgba32(
                        ToByte(pixel.R * alpha + 255f * (1f - alpha)),
                        ToByte(pixel.G * alpha + 255f * (1f - alpha)),
                        ToByte(pixel.B * alpha + 255f * (1f - alpha)),
                        byte.MaxValue);
                }
            }
        });
    }

    private static byte ToByte(float value) =>
        (byte)Math.Clamp((int)MathF.Round(value), 0, 255);

    private static string CreateSafeFileName(string projectName)
    {
        char[] invalidCharacters = Path.GetInvalidFileNameChars();
        string safeName = new(projectName
            .Trim()
            .Select(character => invalidCharacters.Contains(character) ? '_' : character)
            .ToArray());
        return string.IsNullOrWhiteSpace(safeName) ? "project" : safeName;
    }
}