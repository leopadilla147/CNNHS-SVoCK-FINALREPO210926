<?php
// use mail classes
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// load mail libs
require 'PHPMailer-master/src/PHPMailer.php';
require 'PHPMailer-master/src/SMTP.php';
require 'PHPMailer-master/src/Exception.php';

// get inputs
$email = $_POST['email'] ?? '';
$code  = $_POST['code'] ?? '';

// validate email
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo "invalid_email";
    exit;
}

$mail = new PHPMailer(true);

try {
    // smtp setup
    $mail->isSMTP();
    $mail->Host       = 'smtp.gmail.com';
    $mail->SMTPAuth   = true;
    $mail->Username   = 'business0621xxx@gmail.com';     // updated account
    $mail->Password   = 'etnj fugz pjfe pwpe';                  // updated app password
    $mail->SMTPSecure = 'tls';
    $mail->Port       = 587;

    // sender setup
    $mail->setFrom('business0621xxx@gmail.com', 'IFMIS - Municipal Agriculture Office of Mercedes');
    $mail->addAddress($email);

    // email content
    $mail->isHTML(true);
    $mail->Subject = 'IFMIS Verification Code';
    $mail->Body    = "
        <p>Magandang araw,</p>
        <p>Ipinapadala namin ang iyong opisyal na verification code upang makumpleto ang iyong proseso sa IFMIS.</p>
        <p><b>Verification Code: $code</b></p>
        <p>Kung hindi ikaw ang humiling nito, maaari mong balewalain ang mensaheng ito.</p>
        <p>Maraming salamat.</p>
    ";

    // send email
    $mail->send();
    echo "success";

} catch (Exception $e) {
    // error output
    echo "fail: " . $mail->ErrorInfo;
}
?>
