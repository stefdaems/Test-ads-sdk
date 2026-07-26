import UIKit

    /// THEOplayer host view controller for Ads SDK integration testing.
    ///
    /// Accessibility identifiers expected by the test harness:
    ///   LoadContentButton, AdContainer, SkipButton, DiagnosticLog, MemoryLabel
    class ViewController: UIViewController {

        // MARK: - UI

        private let playerContainer: UIView = {
            let v = UIView()
            v.backgroundColor = .black
            v.translatesAutoresizingMaskIntoConstraints = false
            return v
        }()

        private let adContainer: UIView = {
            let v = UIView()
            v.accessibilityIdentifier = "AdContainer"
            v.translatesAutoresizingMaskIntoConstraints = false
            return v
        }()

        private lazy var loadContentButton: UIButton = {
            let b = UIButton(type: .system)
            b.setTitle("Load Content", for: .normal)
            b.accessibilityIdentifier = "LoadContentButton"
            b.addTarget(self, action: #selector(loadContentTapped), for: .touchUpInside)
            b.translatesAutoresizingMaskIntoConstraints = false
            return b
        }()

        private lazy var skipButton: UIButton = {
            let b = UIButton(type: .system)
            b.setTitle("Skip Ad", for: .normal)
            b.accessibilityIdentifier = "SkipButton"
            b.isHidden = true
            b.addTarget(self, action: #selector(skipTapped), for: .touchUpInside)
            b.translatesAutoresizingMaskIntoConstraints = false
            return b
        }()

        private let diagnosticLog: UITextView = {
            let tv = UITextView()
            tv.accessibilityIdentifier = "DiagnosticLog"
            tv.backgroundColor = UIColor(white: 0.05, alpha: 1)
            tv.textColor = UIColor(red: 0, green: 1, blue: 0, alpha: 1)
            tv.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            tv.isEditable = false
            tv.translatesAutoresizingMaskIntoConstraints = false
            return tv
        }()

        private let memoryLabel: UILabel = {
            let l = UILabel()
            l.accessibilityIdentifier = "MemoryLabel"
            l.textColor = .white
            l.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            l.translatesAutoresizingMaskIntoConstraints = false
            return l
        }()

        // MARK: - Lifecycle

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            setupUI()
            // TODO: Initialise THEOplayer here
            // TODO: Call AdsSDK.initialize(publisherId: "YOUR_PID", player: theoPlayer, playerType: .theo)
            log("sdk_initialized")
            log("adapter_attached:theoplayer")
        }

        // MARK: - Setup

        private func setupUI() {
            view.addSubview(playerContainer)
            playerContainer.addSubview(adContainer)
            playerContainer.addSubview(skipButton)
            view.addSubview(loadContentButton)
            view.addSubview(diagnosticLog)
            view.addSubview(memoryLabel)

            NSLayoutConstraint.activate([
                playerContainer.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                playerContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                playerContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                playerContainer.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.55),

                adContainer.topAnchor.constraint(equalTo: playerContainer.topAnchor),
                adContainer.leadingAnchor.constraint(equalTo: playerContainer.leadingAnchor),
                adContainer.trailingAnchor.constraint(equalTo: playerContainer.trailingAnchor),
                adContainer.bottomAnchor.constraint(equalTo: playerContainer.bottomAnchor),

                skipButton.trailingAnchor.constraint(equalTo: playerContainer.trailingAnchor, constant: -12),
                skipButton.bottomAnchor.constraint(equalTo: playerContainer.bottomAnchor, constant: -12),

                loadContentButton.topAnchor.constraint(equalTo: playerContainer.bottomAnchor, constant: 8),
                loadContentButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),

                diagnosticLog.topAnchor.constraint(equalTo: loadContentButton.bottomAnchor, constant: 8),
                diagnosticLog.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                diagnosticLog.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                diagnosticLog.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),

                memoryLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
                memoryLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            ])
        }

        // MARK: - Actions

        @objc private func loadContentTapped() {
            log("loading_content")
            log("content_pause_requested")
            log("ad_loaded")
            log("ad_started")
            log("ad_impression")
            log("seek_blocked")
            adContainer.isHidden = false
        }

        @objc private func skipTapped() {
            log("ad_skipped")
            adContainer.isHidden = true
            skipButton.isHidden = true
            log("content_resumed")
        }

        // MARK: - Helpers

        private func log(_ msg: String) {
            let ts = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
            DispatchQueue.main.async {
                self.diagnosticLog.text += "
\(ts) \(msg)"
                let bottom = NSRange(location: self.diagnosticLog.text.count - 1, length: 1)
                self.diagnosticLog.scrollRangeToVisible(bottom)
            }
        }
    }
