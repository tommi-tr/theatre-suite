//! Finding the cable: the serial ports of this computer with what the user needs to recognise
//! the USB-DMX cable (port, USB VID/PID, manufacturer, product, serial number), the engine's
//! guess, and the ways to open them.
//!
//! On Windows the "product" is the name Windows gives the port (for FTDI chips usually
//! "USB Serial Port"), so names alone rarely tell a Pro from an Open DMX: VID/PID say which
//! chip it is, and on connect the engine asks the device whether it is a Pro.

use serde::Serialize;

use super::driver::{DmxPort, SerialDmxPort};

/// The engine's guess about a port.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Guess {
    /// The name says it is a Pro-type interface (Enttec Pro, DMXking…).
    Pro,
    /// An FTDI chip: an Open DMX cable, or a Pro clone (on connect Granvelo asks it).
    Ftdi,
    /// Another USB serial adapter: not a known DMX cable (can be tried by hand as Open DMX).
    OtherUsb,
    /// Not USB (a built-in or Bluetooth port): not a DMX cable.
    NotUsb,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// "COM3", "/dev/ttyUSB0"…
    pub port: String,
    pub usb: bool,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    /// The chip known from VID/PID ("FTDI FT232R / FT245R"…).
    pub chip: Option<String>,
    pub guess: Guess,
    /// A short name to show ("DMX USB PRO", "FTDI FT232R / FT245R"…).
    pub name: String,
}

/// Why opening or finding a cable failed (the interface explains each code in plain words).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// No USB-DMX cable among the ports.
    NoCable,
    /// The chosen port is not there (unplugged, or another name).
    NotFound,
    /// The port is used by another program.
    Busy,
    /// Any other problem opening the port.
    OpenFailed,
    /// Several possible cables and none answered as a Pro: the user chooses in the Settings.
    ChooseCable,
    /// The DMX engine stopped after an internal error (it restarts by itself, without sending).
    EngineStopped,
}

impl LinkError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        LinkError {
            code,
            message: message.into(),
        }
    }
}

/// The chip of a USB serial adapter, from its VID/PID.
pub fn chip_name(vid: u16, pid: u16) -> Option<&'static str> {
    Some(match (vid, pid) {
        (0x0403, 0x6001) => "FTDI FT232R / FT245R",
        (0x0403, 0x6010) => "FTDI FT2232",
        (0x0403, 0x6011) => "FTDI FT4232",
        (0x0403, 0x6014) => "FTDI FT232H",
        (0x0403, 0x6015) => "FTDI FT-X",
        (0x0403, _) => "FTDI",
        (0x1A86, _) => "WCH CH340 / CH341",
        (0x10C4, _) => "Silicon Labs CP210x",
        (0x067B, _) => "Prolific PL2303",
        (0x0483, 0x5740) => "STM32 (virtual COM port)",
        (0x2341, _) | (0x2A03, _) => "Arduino",
        _ => return None,
    })
}

/// The guess from what the port says about itself.
pub fn guess(
    usb: bool,
    vid: Option<u16>,
    manufacturer: Option<&str>,
    product: Option<&str>,
) -> Guess {
    if !usb {
        return Guess::NotUsb;
    }
    let text = format!("{} {}", manufacturer.unwrap_or(""), product.unwrap_or("")).to_lowercase();
    let says_open = text.contains("open dmx") || text.contains("opendmx");
    let says_pro = text.contains("dmxking")
        || text.contains("ultradmx")
        || (text.contains("dmx") && text.contains("pro"))
        || (text.contains("enttec") && !says_open);
    if says_pro && !says_open {
        Guess::Pro
    } else if vid == Some(0x0403) {
        Guess::Ftdi
    } else {
        Guess::OtherUsb
    }
}

/// What USB says about an adapter: VID, PID, serial number, manufacturer, product.
pub type UsbIds = (u16, u16, Option<String>, Option<String>, Option<String>);

/// Builds the description of a port.
/// A serial number that really belongs to the device, or `None`.
///
/// On Windows `serialport` invents one for devices without a serial (FTDI clones with a blank
/// EEPROM, many cheap adapters): the first piece of the instance ID that Windows makes up,
/// such as "6" from `6&A694CA9&0&0000`, which changes with the USB socket and is the same for
/// two identical cables. Such values (only digits, at most 2 characters, or containing `&`)
/// are not serial numbers.
pub fn real_serial(serial: Option<String>) -> Option<String> {
    let s = serial?.trim().to_string();
    let made_up =
        s.is_empty() || s.contains('&') || (s.len() <= 2 && s.chars().all(|c| c.is_ascii_digit()));
    if made_up { None } else { Some(s) }
}

pub fn describe(port: &str, usb: Option<UsbIds>) -> DeviceInfo {
    match usb {
        Some((vid, pid, serial, manufacturer, product)) => {
            let serial = real_serial(serial);
            let chip = chip_name(vid, pid).map(str::to_string);
            let g = guess(true, Some(vid), manufacturer.as_deref(), product.as_deref());
            let generic = |p: &str| {
                let p = p.to_lowercase();
                p.is_empty()
                    || p.contains("usb serial")
                    || p.contains("usb uart")
                    || p.contains("serial port")
            };
            let name = match (&product, &chip) {
                (Some(p), _) if !generic(p) => p.clone(),
                (_, Some(c)) => c.clone(),
                (Some(p), None) => p.clone(),
                (None, None) => format!("USB {vid:04X}:{pid:04X}"),
            };
            DeviceInfo {
                port: port.to_string(),
                usb: true,
                vid: Some(vid),
                pid: Some(pid),
                manufacturer,
                product,
                serial,
                chip,
                guess: g,
                name,
            }
        }
        None => DeviceInfo {
            port: port.to_string(),
            usb: false,
            vid: None,
            pid: None,
            manufacturer: None,
            product: None,
            serial: None,
            chip: None,
            guess: Guess::NotUsb,
            name: port.to_string(),
        },
    }
}

/// The same physical device in a new list (after it was unplugged and plugged back).
/// - With a serial number: the device with the same VID/PID and serial, on any port.
/// - Without one: among the devices with the same VID/PID **and no serial number** (a device
///   with a serial is certainly another one), the one on the same port, otherwise the only one.
/// - With a serial number not found again: the no-serial rule, in case the cable now reports
///   none; never a device with a different serial number (that is another cable).
/// - Not USB: the same port name.
pub fn find_again<'a>(list: &'a [DeviceInfo], dev: &DeviceInfo) -> Option<&'a DeviceInfo> {
    if !dev.usb {
        return list.iter().find(|d| d.port == dev.port);
    }
    let same_ids = |d: &&DeviceInfo| d.usb && d.vid == dev.vid && d.pid == dev.pid;
    if dev.serial.is_some()
        && let Some(d) = list
            .iter()
            .filter(same_ids)
            .find(|d| d.serial == dev.serial)
    {
        return Some(d);
    }
    let no_serial: Vec<&DeviceInfo> = list
        .iter()
        .filter(same_ids)
        .filter(|d| d.serial.is_none())
        .collect();
    if let Some(d) = no_serial.iter().find(|d| d.port == dev.port) {
        return Some(d);
    }
    if no_serial.len() == 1 {
        Some(no_serial[0])
    } else {
        None
    }
}

/// Where ports come from and how they are opened (the real computer, or fakes in the tests).
pub trait Backend: Send + Sync {
    fn list(&self) -> Vec<DeviceInfo>;
    fn open(&self, port: &str) -> Result<Box<dyn DmxPort>, LinkError>;
}

/// The serial ports of this computer.
pub struct SystemBackend;

impl Backend for SystemBackend {
    fn list(&self) -> Vec<DeviceInfo> {
        let ports = match serialport::available_ports() {
            Ok(p) => p,
            Err(e) => {
                log_line(&format!("listing serial ports failed: {e}"));
                return Vec::new();
            }
        };
        let mut out: Vec<DeviceInfo> = ports
            .into_iter()
            .map(|p| match p.port_type {
                serialport::SerialPortType::UsbPort(u) => describe(
                    &p.port_name,
                    Some((u.vid, u.pid, u.serial_number, u.manufacturer, u.product)),
                ),
                _ => describe(&p.port_name, None),
            })
            .collect();
        // USB first (the cables), then by name.
        out.sort_by(|a, b| b.usb.cmp(&a.usb).then_with(|| a.port.cmp(&b.port)));
        out
    }

    fn open(&self, port: &str) -> Result<Box<dyn DmxPort>, LinkError> {
        match SerialDmxPort::open(port) {
            Ok(p) => Ok(Box::new(p)),
            Err(e) => Err(open_error(port, &e)),
        }
    }
}

fn open_error(port: &str, e: &serialport::Error) -> LinkError {
    let message = format!("{port}: {e}");
    // Windows reports "in use" and "not there" alike (and in the system language): the port
    // being still listed is what tells them apart.
    let listed = serialport::available_ports()
        .map(|l| l.iter().any(|p| p.port_name == port))
        .unwrap_or(true);
    let code = match e.kind {
        _ if !listed => ErrorCode::NotFound,
        serialport::ErrorKind::NoDevice
        | serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => ErrorCode::Busy,
        serialport::ErrorKind::Io(std::io::ErrorKind::NotFound) => ErrorCode::NotFound,
        _ => ErrorCode::OpenFailed,
    };
    LinkError::new(code, message)
}

/// Diagnostics on stderr (visible when Granvelo is started from a terminal).
pub fn log_line(s: &str) {
    eprintln!("[granvelo dmx] {s}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(
        port: &str,
        vid: u16,
        pid: u16,
        serial: Option<&str>,
        m: Option<&str>,
        p: Option<&str>,
    ) -> DeviceInfo {
        describe(
            port,
            Some((
                vid,
                pid,
                serial.map(Into::into),
                m.map(Into::into),
                p.map(Into::into),
            )),
        )
    }

    #[test]
    fn guesses_from_names_and_chips() {
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                Some("EN123"),
                Some("ENTTEC"),
                Some("DMX USB PRO")
            )
            .guess,
            Guess::Pro
        );
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                None,
                Some("FTDI"),
                Some("USB Serial Port")
            )
            .guess,
            Guess::Ftdi
        );
        assert_eq!(
            usb(
                "COM4",
                0x0403,
                0x6001,
                None,
                Some("ENTTEC"),
                Some("Open DMX USB")
            )
            .guess,
            Guess::Ftdi
        );
        assert_eq!(
            usb(
                "COM5",
                0x1A86,
                0x7523,
                None,
                Some("wch.cn"),
                Some("USB-SERIAL CH340")
            )
            .guess,
            Guess::OtherUsb
        );
        assert_eq!(describe("COM1", None).guess, Guess::NotUsb);
        let d = usb(
            "COM3",
            0x0403,
            0x6001,
            None,
            Some("FTDI"),
            Some("USB Serial Port"),
        );
        assert_eq!(d.name, "FTDI FT232R / FT245R");
        assert_eq!(d.chip.as_deref(), Some("FTDI FT232R / FT245R"));
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                None,
                Some("ENTTEC"),
                Some("DMX USB PRO")
            )
            .name,
            "DMX USB PRO"
        );
    }

    #[test]
    fn finds_the_same_cable_again_by_identity_not_by_port_name() {
        let before = usb("COM3", 0x0403, 0x6001, Some("A1"), None, None);
        let list = vec![
            usb("COM3", 0x0403, 0x6001, Some("B2"), None, None),
            usb("COM7", 0x0403, 0x6001, Some("A1"), None, None),
        ];
        assert_eq!(find_again(&list, &before).unwrap().port, "COM7");
        let no_serial = usb("COM3", 0x0403, 0x6001, None, None, None);
        assert_eq!(
            find_again(&[usb("COM9", 0x0403, 0x6001, None, None, None)], &no_serial)
                .unwrap()
                .port,
            "COM9"
        );
        assert!(
            find_again(
                &[
                    usb("COM9", 0x0403, 0x6001, None, None, None),
                    usb("COM8", 0x0403, 0x6001, None, None, None)
                ],
                &no_serial
            )
            .is_none()
        );
        assert!(find_again(&[usb("COM3", 0x1A86, 0x7523, None, None, None)], &no_serial).is_none());
    }

    #[test]
    fn serial_numbers_made_up_by_windows_are_not_serial_numbers() {
        assert_eq!(real_serial(Some("6".into())), None);
        assert_eq!(real_serial(Some("5".into())), None);
        assert_eq!(real_serial(Some("12".into())), None);
        assert_eq!(real_serial(Some("5&2B4C1A&0&2".into())), None);
        assert_eq!(real_serial(Some("  ".into())), None);
        assert_eq!(
            real_serial(Some("A702TB52".into())).as_deref(),
            Some("A702TB52")
        );
        assert_eq!(real_serial(Some("123".into())).as_deref(), Some("123"));
        assert_eq!(
            usb("COM3", 0x0403, 0x6001, Some("6"), None, None).serial,
            None
        );
    }

    #[test]
    fn a_cable_without_serial_is_found_again_on_another_hub() {
        // Windows gave "6" before and "7" after the replug: both mean "no serial".
        let before = usb("COM3", 0x0403, 0x6001, Some("6"), None, None);
        let after = vec![usb("COM5", 0x0403, 0x6001, Some("7"), None, None)];
        assert_eq!(find_again(&after, &before).unwrap().port, "COM5");
        // Two identical serial-less cables: only the one on the same port, never a guess.
        let two = vec![
            usb("COM5", 0x0403, 0x6001, Some("6"), None, None),
            usb("COM6", 0x0403, 0x6001, Some("6"), None, None),
        ];
        assert!(find_again(&two, &before).is_none());
        let two_same_port = vec![
            usb("COM3", 0x0403, 0x6001, Some("6"), None, None),
            usb("COM6", 0x0403, 0x6001, Some("6"), None, None),
        ];
        assert_eq!(find_again(&two_same_port, &before).unwrap().port, "COM3");
    }

    #[test]
    fn a_cable_without_serial_is_never_confused_with_one_that_has_a_serial() {
        let lost = usb("COM3", 0x0403, 0x6001, None, None, None);
        assert!(
            find_again(
                &[usb("COM3", 0x0403, 0x6001, Some("A702TB52"), None, None)],
                &lost
            )
            .is_none()
        );
        // And a cable with a serial is never replaced by another serial.
        let lost = usb("COM3", 0x0403, 0x6001, Some("A1B2C3D4"), None, None);
        assert!(
            find_again(
                &[usb("COM3", 0x0403, 0x6001, Some("Z9Y8X7W6"), None, None)],
                &lost
            )
            .is_none()
        );
    }
}
