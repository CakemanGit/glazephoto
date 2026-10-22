# Сборка бэкенда
FROM ://microsoft.com AS build-env
WORKDIR /app

# Копируем проект и восстанавливаем зависимости
COPY backend/backend.csproj ./backend/
RUN dotnet restore backend/backend.csproj

# Копируем исходники и собираем релиз
COPY backend/ ./backend/
RUN dotnet publish backend/backend.csproj -c Release -o out

# Финальный образ для запуска
FROM ://microsoft.com AS runtime
WORKDIR /app
COPY --from=build-env /app/out .

# Явно открываем порт 8080
EXPOSE 8080
ENV ASPNETCORE_URLS=http://0.0.0

ENTRYPOINT ["dotnet", "backend.dll"]
