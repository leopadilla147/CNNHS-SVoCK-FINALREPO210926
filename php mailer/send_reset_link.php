<?php
// Sends a one-time reset code (letters + numbers) instead of a link
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer-master/src/PHPMailer.php';
require 'PHPMailer-master/src/SMTP.php';
require 'PHPMailer-master/src/Exception.php';

require_once '../db_connect.php';

header('Content-Type: text/plain');

function generateResetCode(int $length = 8): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
    $code = '';
    $maxIndex = strlen($chars) - 1;
    for ($i = 0; $i < $length; $i++) {
        $code .= $chars[random_int(0, $maxIndex)];
    }
    return $code;
}

try {
    $email = isset($_POST['email']) ? trim($_POST['email']) : '';
    if (!$email) {
        echo "empty_email";
        exit;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo "invalid_email";
        exit;
    }

    // Check if email exists in user table
    $sql = "SELECT UserID, FullName FROM user WHERE EmailAddress = ? LIMIT 1";
    $user = fetchSingleRow($sql, [$email], "s");

    if (!$user) {
        echo "email_not_found";
        exit;
    }

    $userID = (int)$user['UserID'];
    $fullName = $user['FullName'] ?: 'User';

    // Invalidate any previous unused codes for this user
    executePreparedStatement("UPDATE passwordreset SET Used = 1 WHERE UserID = ? AND Used = 0", [$userID], "i");

    // Generate new code and store it
    $code = generateResetCode(8);
    $expires = date("Y-m-d H:i:s", strtotime("+1 hour"));
    executePreparedStatement(
        "INSERT INTO passwordreset (UserID, Token, Expires, Used) VALUES (?, ?, ?, 0)",
        [$userID, $code, $expires],
        "iss"
    );

    // Send reset code via email
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'business0621xxx@gmail.com';        // Gmail account
        $mail->Password   = 'etnj fugz pjfe pwpe';                     // Gmail App Password
        $mail->SMTPSecure = 'tls';
        $mail->Port       = 587;

        $mail->setFrom('business0621xxx@gmail.com', 'IFMIS');
        $mail->addAddress($email, $fullName);

        $safeName = htmlspecialchars($fullName, ENT_QUOTES, 'UTF-8');
        $safeCode = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');

        $mail->isHTML(true);
        $mail->Subject = 'IFMIS Password Reset Code';
        $mail->Body    = "
            <p>Magandang araw, <strong>{$safeName}</strong>,</p>
            <p>Nakatanggap kami ng request para i-reset ang iyong password.</p>
            <p>Ilagay ang code na ito sa reset page upang magpatuloy:</p>
            <p style=\"font-size:20px; font-weight:bold; letter-spacing:2px;\">{$safeCode}</p>
            <p>Ang code ay balido lamang sa loob ng 1 oras.</p>
            <p>Kung hindi ikaw ang nag-request nito, pakipabayaan lamang ang email na ito.</p>
            <p>Maraming salamat.</p>
            <p><strong>IFMIS - Municipal Agriculture Office</strong></p>
        ";

        $mail->AltBody = "Magandang araw, {$fullName},\n\n" .
                         "Ilagay ang code na ito upang i-reset ang iyong password: {$code}\n" .
                         "Balido lamang sa loob ng 1 oras.\n\n" .
                         "Kung hindi ikaw ang nag-request nito, pakipabayaan lamang ang email na ito.";

        $mail->send();
        echo "success";
    } catch (Exception $e) {
        error_log('Reset code email error: ' . $mail->ErrorInfo);
        echo "email_error";
    }

} catch (Exception $e) {
    error_log("Send reset code error: " . $e->getMessage());
    echo "error: " . $e->getMessage();
}
?>
