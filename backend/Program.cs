using GlazeApi.Services;

public partial class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // 1. Настройка CORS для связи с React-фронтендом (pnpm/Vite на порту 5173)
        builder.Services.AddCors(options =>
        {
            options.AddPolicy("AllowFrontend", policy =>
            {
                policy.WithOrigins("http://localhost:5173")
                      .AllowAnyMethod()
                      .AllowAnyHeader();
            });
        });

        // 2. Регистрация всех сервисов графического движка в DI-контейнере
        builder.Services.AddScoped<ImageParser>();
        builder.Services.AddScoped<SimdOptimizer>();
        builder.Services.AddScoped<BrightnessContrastFilter>();
        builder.Services.AddScoped<GaussianBlurFilter>();
        builder.Services.AddScoped<ProjectExporter>();

        // 3. Поддержка контроллеров (для ImageProcessingController)
        builder.Services.AddControllers();

        // 4. Поддержка описания API и Swagger (генератор документации)
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen();

        var app = builder.Build();

        // 5. Конфигурация конвейера обработки (Middleware)
        if (app.Environment.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI(c =>
            {
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "GlazePhoto API v1");
            });
        }

        // Критически важно: CORS включается строго ДО авторизации и маршрутизации
        app.UseCors("AllowFrontend");

        app.UseAuthorization();

        app.MapControllers();

        app.Run();
    }
}
