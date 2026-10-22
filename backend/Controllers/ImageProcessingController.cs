using GlazeApi.Services;
using Microsoft.AspNetCore.Mvc;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace GlazeApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class ImageProcessingController(
    ILogger<ImageProcessingController> logger,
    SimdOptimizer simdOptimizer,
    GaussianBlurFilter gaussianBlurFilter,
    ProjectExporter projectExporter) : ControllerBase
{
    [HttpPost("ProcessImage")]
    [Consumes("multipart/form-data")]
    [Produces("image/png")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> ProcessImage(
        [FromForm] IFormFile image,
        [FromForm] string filterType,
        CancellationToken cancellationToken)
    {
        if (image is null || image.Length == 0)
        {
            return BadRequest("An image file is required.");
        }

        if (string.IsNullOrWhiteSpace(filterType))
        {
            return BadRequest("A filter type is required.");
        }

        string normalizedFilter = filterType.Trim().ToLowerInvariant();
        if (normalizedFilter is not ("negative" or "gaussian-blur"))
        {
            return BadRequest("Supported filters are 'negative' and 'gaussian-blur'.");
        }

        try
        {
            logger.LogInformation(
                "Processing uploaded image {FileName} with filter {FilterType}.",
                image.FileName,
                normalizedFilter);

            using Image<Rgba32> decoded =
                await ImageParser.LoadAsync(image, cancellationToken);

            switch (normalizedFilter)
            {
                case "negative":
                    simdOptimizer.InvertRgba(decoded);
                    break;
                case "gaussian-blur":
                    gaussianBlurFilter.Apply(decoded, sigma: 2f);
                    break;
            }

            await using var output = new MemoryStream();
            await decoded.SaveAsPngAsync(output, cancellationToken);
            return File(output.ToArray(), "image/png", "processed.png");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is InvalidDataException or
            InvalidImageContentException or
            UnknownImageFormatException)
        {
            logger.LogWarning(
                exception,
                "Rejected invalid uploaded image {FileName}.",
                image.FileName);
            return BadRequest("The uploaded file is not a valid supported image.");
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Failed to process uploaded image {FileName}.",
                image.FileName);
            return Problem(
                title: "Image processing failed.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    [HttpPost("Export/Session")]
    [Produces("application/zip")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportSession(
        [FromBody] ProjectExportRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await projectExporter.CreateSessionArchiveAsync(request, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return BadRequest(exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidImageContentException or UnknownImageFormatException)
        {
            logger.LogWarning(exception, "Rejected invalid image data in project session export.");
            return BadRequest("A project layer contains an invalid or unsupported image.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to export project session.");
            return Problem(
                title: "Project export failed.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    [HttpPost("Export/Flattened")]
    [Produces("image/png", "image/jpeg")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportFlattened(
        [FromQuery] string format,
        [FromBody] ProjectExportRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await projectExporter.CreateFlattenedImageAsync(
                request,
                format,
                cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return BadRequest(exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidImageContentException or UnknownImageFormatException)
        {
            logger.LogWarning(exception, "Rejected invalid image data in flattened project export.");
            return BadRequest("A project layer contains an invalid or unsupported image.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Failed to export flattened project image.");
            return Problem(
                title: "Project export failed.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }
}
