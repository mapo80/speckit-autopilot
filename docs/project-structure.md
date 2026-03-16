# Project Structure — SignHub

```
SignHub/
├── src/
│   ├── SignHub.Domain/
│   │   ├── SignHub.Domain.csproj
│   │   ├── Entities/
│   │   │   ├── Room.cs
│   │   │   ├── RoomTemplate.cs
│   │   │   ├── RoomTemplateField.cs
│   │   │   ├── Signer.cs
│   │   │   ├── Signature.cs
│   │   │   ├── Attachment.cs
│   │   │   ├── Document.cs
│   │   │   ├── Webhook.cs
│   │   │   ├── WebhookEvent.cs
│   │   │   ├── ApiKey.cs
│   │   │   └── User.cs
│   │   ├── Enums/
│   │   │   ├── RoomStatus.cs
│   │   │   ├── SigningWorkflow.cs
│   │   │   ├── FieldType.cs
│   │   │   ├── FieldProvenance.cs
│   │   │   ├── WebhookEventType.cs
│   │   │   └── Permission.cs
│   │   ├── Exceptions/
│   │   │   ├── DomainException.cs
│   │   │   └── EntityNotFoundException.cs
│   │   └── Interfaces/
│   │       ├── Repositories/
│   │       │   ├── IRoomRepository.cs
│   │       │   ├── IRoomTemplateRepository.cs
│   │       │   ├── ISignatureRepository.cs
│   │       │   ├── IAttachmentRepository.cs
│   │       │   ├── IWebhookRepository.cs
│   │       │   └── IApiKeyRepository.cs
│   │       ├── ISigningProvider.cs
│   │       ├── IStorageProvider.cs
│   │       ├── IDocumentAssembler.cs
│   │       └── IWebhookDispatcher.cs
│   │
│   ├── SignHub.Services/
│   │   ├── SignHub.Services.csproj
│   │   ├── Rooms/
│   │   │   ├── IRoomService.cs
│   │   │   ├── RoomService.cs
│   │   │   ├── IRoomFinalizer.cs
│   │   │   ├── RoomFinalizer.cs
│   │   │   └── RoomStatusMachine.cs
│   │   ├── Templates/
│   │   │   ├── IRoomTemplateService.cs
│   │   │   └── RoomTemplateService.cs
│   │   ├── Signatures/
│   │   │   ├── ISignatureService.cs
│   │   │   └── SignatureService.cs
│   │   ├── Webhooks/
│   │   │   ├── IWebhookService.cs
│   │   │   └── WebhookService.cs
│   │   ├── Providers/
│   │   │   ├── Signing/
│   │   │   │   ├── LocalSigningProvider.cs
│   │   │   │   └── ExternalSigningProvider.cs
│   │   │   ├── Storage/
│   │   │   │   ├── AzureBlobStorageProvider.cs
│   │   │   │   └── LocalFileStorageProvider.cs
│   │   │   └── DocumentAssembly/
│   │   │       └── DocumentAssemblerClient.cs
│   │   ├── Jobs/
│   │   │   ├── HangfireJobRegistration.cs
│   │   │   ├── WebhookRetryJob.cs
│   │   │   └── RoomExpirationJob.cs
│   │   └── DependencyInjection.cs
│   │
│   ├── SignHub.Dal/
│   │   ├── SignHub.Dal.csproj
│   │   ├── SignHubDbContext.cs
│   │   ├── Configurations/
│   │   │   ├── RoomConfiguration.cs
│   │   │   ├── RoomTemplateConfiguration.cs
│   │   │   ├── RoomTemplateFieldConfiguration.cs
│   │   │   ├── SignerConfiguration.cs
│   │   │   ├── SignatureConfiguration.cs
│   │   │   ├── AttachmentConfiguration.cs
│   │   │   ├── DocumentConfiguration.cs
│   │   │   ├── WebhookConfiguration.cs
│   │   │   ├── WebhookEventConfiguration.cs
│   │   │   ├── ApiKeyConfiguration.cs
│   │   │   └── UserConfiguration.cs
│   │   ├── Repositories/
│   │   │   ├── RoomRepository.cs
│   │   │   ├── RoomTemplateRepository.cs
│   │   │   ├── SignatureRepository.cs
│   │   │   ├── AttachmentRepository.cs
│   │   │   ├── WebhookRepository.cs
│   │   │   └── ApiKeyRepository.cs
│   │   ├── Migrations/
│   │   └── DependencyInjection.cs
│   │
│   ├── SignHub.Api/
│   │   ├── SignHub.Api.csproj
│   │   ├── Program.cs
│   │   ├── appsettings.json
│   │   ├── appsettings.Development.json
│   │   ├── Controllers/
│   │   │   ├── RoomsController.cs
│   │   │   ├── RoomTemplatesController.cs
│   │   │   ├── SignaturesController.cs
│   │   │   ├── AttachmentsController.cs
│   │   │   └── WebhooksController.cs
│   │   ├── Dtos/
│   │   │   ├── Requests/
│   │   │   │   ├── CreateRoomRequest.cs
│   │   │   │   ├── CreateRoomTemplateRequest.cs
│   │   │   │   ├── UpdateRoomTemplateRequest.cs
│   │   │   │   ├── SubmitSignatureRequest.cs
│   │   │   │   ├── FinalizeRoomRequest.cs
│   │   │   │   └── UploadAttachmentRequest.cs
│   │   │   └── Responses/
│   │   │       ├── RoomResponse.cs
│   │   │       ├── RoomTemplateResponse.cs
│   │   │       ├── SignatureResponse.cs
│   │   │       └── AttachmentResponse.cs
│   │   ├── Mapping/
│   │   │   └── DtoMappingProfile.cs
│   │   ├── Middleware/
│   │   │   ├── ApiKeyAuthenticationHandler.cs
│   │   │   ├── ExceptionHandlingMiddleware.cs
│   │   │   └── PermissionAuthorizationHandler.cs
│   │   └── Filters/
│   │       └── ValidationActionFilter.cs
│   │
│   ├── signhub-web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── public/
│   │   │   └── favicon.ico
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── vite-env.d.ts
│   │       ├── theme/
│   │       │   └── antd-theme.ts
│   │       ├── api/
│   │       │   ├── api-client.ts
│   │       │   ├── rooms-api.ts
│   │       │   ├── templates-api.ts
│   │       │   ├── signatures-api.ts
│   │       │   └── attachments-api.ts
│   │       ├── hooks/
│   │       │   ├── use-rooms.ts
│   │       │   ├── use-templates.ts
│   │       │   └── use-auth.ts
│   │       ├── components/
│   │       │   ├── layout/
│   │       │   │   ├── app-layout.tsx
│   │       │   │   ├── sidebar-menu.tsx
│   │       │   │   └── header-bar.tsx
│   │       │   ├── rooms/
│   │       │   │   ├── room-list.tsx
│   │       │   │   ├── room-detail.tsx
│   │       │   │   ├── room-create-form.tsx
│   │       │   │   └── room-status-badge.tsx
│   │       │   ├── templates/
│   │       │   │   ├── template-list.tsx
│   │       │   │   ├── template-form.tsx
│   │       │   │   └── field-schema-editor.tsx
│   │       │   ├── signatures/
│   │       │   │   ├── signature-pad.tsx
│   │       │   │   └── signer-list.tsx
│   │       │   ├── attachments/
│   │       │   │   ├── attachment-uploader.tsx
│   │       │   │   └── attachment-list.tsx
│   │       │   └── shared/
│   │       │       ├── permission-guard.tsx
│   │       │       ├── loading-spinner.tsx
│   │       │       └── error-boundary.tsx
│   │       ├── pages/
│   │       │   ├── rooms-page.tsx
│   │       │   ├── room-detail-page.tsx
│   │       │   ├── templates-page.tsx
│   │       │   ├── template-detail-page.tsx
│   │       │   └── not-found-page.tsx
│   │       ├── routes/
│   │       │   └── app-routes.tsx
│   │       ├── store/
│   │       │   └── auth-store.ts
│   │       └── types/
│   │           ├── room.ts
│   │           ├── template.ts
│   │           ├── signature.ts
│   │           └── api.ts
│   │
│   └── signhub_mobile/
│       ├── pubspec.yaml
│       ├── analysis_options.yaml
│       ├── lib/
│       │   ├── main.dart
│       │   ├── app.dart
│       │   ├── config/
│       │   │   ├── app_config.dart
│       │   │   └── routes.dart
│       │   ├── models/
│       │   │   ├── room.dart
│       │   │   ├── room_template.dart
│       │   │   ├── signer.dart
│       │   │   └── signature.dart
│       │   ├── services/
│       │   │   ├── api_client.dart
│       │   │   ├── room_service.dart
│       │   │   ├── signature_service.dart
│       │   │   └── auth_service.dart
│       │   ├── providers/
│       │   │   ├── room_provider.dart
│       │   │   ├── auth_provider.dart
│       │   │   └── signature_provider.dart
│       │   ├── screens/
│       │   │   ├── room_list_screen.dart
│       │   │   ├── room_detail_screen.dart
│       │   │   ├── signature_screen.dart
│       │   │   └── login_screen.dart
│       │   └── widgets/
│       │       ├── room_card.dart
│       │       ├── signature_pad.dart
│       │       ├── attachment_picker.dart
│       │       └── status_badge.dart
│       └── test/
│           └── widget_test.dart
│
├── tests/
│   ├── SignHub.Domain.Tests/
│   │   ├── SignHub.Domain.Tests.csproj
│   │   └── Entities/
│   │       ├── RoomTests.cs
│   │       └── RoomTemplateTests.cs
│   ├── SignHub.Services.Tests/
│   │   ├── SignHub.Services.Tests.csproj
│   │   ├── Rooms/
│   │   │   ├── RoomServiceTests.cs
│   │   │   ├── RoomFinalizerTests.cs
│   │   │   └── RoomStatusMachineTests.cs
│   │   ├── Templates/
│   │   │   └── RoomTemplateServiceTests.cs
│   │   ├── Signatures/
│   │   │   └── SignatureServiceTests.cs
│   │   └── Webhooks/
│   │       └── WebhookServiceTests.cs
│   ├── SignHub.Dal.Tests/
│   │   ├── SignHub.Dal.Tests.csproj
│   │   └── Repositories/
│   │       ├── RoomRepositoryTests.cs
│   │       └── RoomTemplateRepositoryTests.cs
│   ├── SignHub.Api.Tests/
│   │   ├── SignHub.Api.Tests.csproj
│   │   └── Controllers/
│   │       ├── RoomsControllerTests.cs
│   │       ├── RoomTemplatesControllerTests.cs
│   │       └── SignaturesControllerTests.cs
│   └── SignHub.Integration.Tests/
│       ├── SignHub.Integration.Tests.csproj
│       ├── Fixtures/
│       │   └── WebAppFactory.cs
│       └── Endpoints/
│           ├── RoomEndpointTests.cs
│           ├── RoomTemplateEndpointTests.cs
│           └── SignatureEndpointTests.cs
│
├── SignHub.sln
├── .gitignore
├── .editorconfig
└── docs/
    ├── product.md
    ├── product-backlog.yaml
    ├── project-structure.md
    └── tech-stack.md
```

## Naming Conventions

| Layer | Convention | Example |
|---|---|---|
| C# projects | `SignHub.{Layer}` PascalCase | `SignHub.Api`, `SignHub.Domain` |
| C# classes / files | PascalCase | `RoomsController.cs`, `RoomService.cs` |
| C# Entity Framework configs | `{Entity}Configuration.cs` | `RoomConfiguration.cs` |
| C# Controllers | `{PluralEntity}Controller.cs` | `RoomsController.cs` |
| C# DTOs requests | `{Verb}{Entity}Request.cs` | `CreateRoomRequest.cs` |
| C# DTOs responses | `{Entity}Response.cs` | `RoomResponse.cs` |
| C# interfaces | `I` + PascalCase | `IRoomService`, `IRoomRepository` |
| C# service interfaces | Co-located with implementation | `IRoomService.cs` next to `RoomService.cs` |
| C# test projects | `SignHub.{Layer}.Tests` | `SignHub.Api.Tests` |
| C# test classes | `{ClassUnderTest}Tests.cs` | `RoomServiceTests.cs` |
| React project folder | `signhub-web` (kebab-case) | — |
| React components | kebab-case `.tsx` files | `room-list.tsx`, `permission-guard.tsx` |
| React pages | `{name}-page.tsx` | `rooms-page.tsx` |
| React hooks | `use-{name}.ts` | `use-rooms.ts` |
| React API modules | `{name}-api.ts` | `rooms-api.ts` |
| React store files | `{name}-store.ts` | `auth-store.ts` |
| React type files | `{name}.ts` in `types/` | `room.ts` |
| Flutter project folder | `signhub_mobile` (snake_case) | — |
| Dart files | snake_case `.dart` | `room_list_screen.dart` |
| Dart classes | PascalCase | `RoomListScreen`, `RoomCard` |
| Dart screens | `{name}_screen.dart` | `room_detail_screen.dart` |
| Dart widgets | `{name}.dart` snake_case | `room_card.dart` |
| Dart services | `{name}_service.dart` | `room_service.dart` |
| Dart models | `{name}.dart` singular snake_case | `room.dart` |
| Dart providers | `{name}_provider.dart` | `auth_provider.dart` |

## RULES (MANDATORY)

### No Duplicate Layers
- NEVER create `src/Api/`, `src/Services/`, `src/Dal/`, or `src/Domain/`. The canonical paths are `src/SignHub.Api/`, `src/SignHub.Services/`, `src/SignHub.Dal/`, `src/SignHub.Domain/`.
- NEVER create `src/web/`, `src/frontend/`, or `src/client/`. The canonical frontend path is `src/signhub-web/`.
- NEVER create `src/mobile/`, `src/app/`, or `src/flutter/`. The canonical mobile path is `src/signhub_mobile/`.
- NEVER create `src/Tests/`, `src/test/`, or `tests/UnitTests/`. All test projects live under the root `tests/` directory using the `SignHub.{Layer}.Tests` naming pattern.
- NEVER create `src/SignHub.Infrastructure/` or `src/SignHub.Common/`. Provider implementations belong in `src/SignHub.Services/Providers/`.

### Files That Must Exist Exactly Once
- `src/SignHub.Api/Program.cs` — sole application entry point
- `src/SignHub.Dal/SignHubDbContext.cs` — sole EF Core DbContext
- `src/SignHub.Api/Mapping/DtoMappingProfile.cs` — sole AutoMapper/mapping profile
- `src/signhub-web/src/main.tsx` — sole React entry point
- `src/signhub-web/src/App.tsx` — sole root React component
- `src/signhub-web/src/routes/app-routes.tsx` — sole route definition file
- `src/signhub-web/src/theme/antd-theme.ts` — sole Ant Design ConfigProvider theme
- `src/signhub-web/src/api/api-client.ts` — sole HTTP client instance
- `src/signhub_mobile/lib/main.dart` — sole Flutter entry point
- `src/signhub_mobile/lib/app.dart` — sole MaterialApp widget
- `src/signhub_mobile/lib/services/api_client.dart` — sole mobile HTTP client instance
- `src/signhub_mobile/lib/config/routes.dart` — sole mobile route definition
- `SignHub.sln` — sole solution file at project root

### Structural Constraints
- Every C# entity in `Domain/Entities/` must have a corresponding `Configuration` in `Dal/Configurations/`.
- Every controller in `Api/Controllers/` must have a matching request DTO in `Api/Dtos/Requests/` and response DTO in `Api/Dtos/Responses/`.
- Repository interfaces live in `Domain/Interfaces/Repositories/`; implementations live in `Dal/Repositories/`.
- Service-layer provider interfaces (`ISigningProvider`, `IStorageProvider`, `IDocumentAssembler`) live in `Domain/Interfaces/`; implementations live in `Services/Providers/`.
- Service interfaces (`IRoomService`, `IRoomTemplateService`, etc.) are co-located with their implementation in the corresponding `Services/` subfolder.
- Hangfire job classes live exclusively in `Services/Jobs/`.
- Migrations live exclusively in `Dal/Migrations/`; never create migration files elsewhere.
- Every React page in `pages/` must be registered in `routes/app-routes.tsx`.
- Every Flutter screen in `screens/` must be registered in `config/routes.dart`.
- No business logic in controllers — controllers delegate to services only.
- No direct `SignHubDbContext` usage outside `src/SignHub.Dal/`.
- No Ant Design imports outside `src/signhub-web/src/` — the theme is configured once in `antd-theme.ts`.
