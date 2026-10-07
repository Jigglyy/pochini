fn main() {
    // Custom Windows application manifest.
    //
    // Two things must both be here:
    //
    // 1. The Common-Controls v6 dependency. This is the entire contents of
    //    tauri-build's stock manifest, and replacing the manifest without it
    //    makes the loader bind comctl32 v5, which lacks exports tao/WebView2
    //    need - the binary then fails to start with STATUS_ENTRYPOINT_NOT_FOUND
    //    (0xc0000139) and no other diagnostic. Do not remove it.
    //
    // 2. PerMonitorV2 DPI awareness, which is the reason for the custom
    //    manifest in the first place. The manifest applies before main() runs
    //    and is authoritative; input::win::init_dpi_awareness() is the belt to
    //    this braces. Without it Windows virtualizes absolute SendInput
    //    coordinates on any monitor whose scaling differs from the primary.
    //    See docs/02-windows-input-research.md.
    //
    // requestedExecutionLevel stays asInvoker deliberately: elevating to reach
    // elevated windows is the user's explicit choice, not a manifest default.
    // See CLAUDE.md rule 8.
    const MANIFEST: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}" />
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}" />
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}" />
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}" />
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>
"#;

    let attrs = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(MANIFEST));
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
