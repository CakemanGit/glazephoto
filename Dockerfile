# Используем официальный SDK .NET 10 для сборки
FROM ://microsoft.com AS build-env
WORKDIR /app

# Копируем проект бэкенда и восстанавливаем зависимости
COPY backend/backend.csproj ./backend/
RUN dotnet restore ./backend/backend.csproj

# Копируем остальные файлы бэкенда и собираем его
COPY backend/ ./backend/
RUN dotnet publish ./backend/backend.csproj -c Release -o out

# Создаем финальный минимальный образ для запуска
FROM ://microsoft.com
WORKDIR /app
COPY --from=build-env /app/out .

# Открываем порт, который обычно ожидает хостинг
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "backend.dll"]
